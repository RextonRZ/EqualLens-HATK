import logging
import re
from io import BytesIO
from typing import List, Set

# PDF - Attempt to import PyMuPDF (fitz) first for better hyperlink extraction
try:
    import fitz  # PyMuPDF

    pymupdf_available = True
    logging.info("PyMuPDF (fitz) found. Advanced PDF hyperlink extraction enabled.")
except ImportError:
    pymupdf_available = False
    logging.warning(
        "PyMuPDF (fitz) not installed. PDF hyperlink extraction will be disabled. Falling back to text-based URL extraction. Consider `pip install PyMuPDF`")
    # Fallback to PyPDF2 for basic text extraction if PyMuPDF is not available
    try:
        from PyPDF2 import PdfReader

        pypdf2_available = True
        logging.info("PyPDF2 found. Using for basic PDF text extraction.")
    except ImportError:
        pypdf2_available = False
        logging.warning("PyPDF2 not installed. PDF raw text extraction will be limited. Consider `pip install PyPDF2`")

# DOCX
try:
    import docx

    docx_available = True
except ImportError:
    docx_available = False
    logging.warning(
        "python-docx not installed. DOCX raw text extraction will be limited. Consider `pip install python-docx`")

logger = logging.getLogger(__name__)


class RawTextExtractor:

    @staticmethod
    def extract_text_and_hyperlinks_from_pdf(file_bytes: bytes) -> tuple[str, List[str]]:
        """
        Extracts both visible text and embedded hyperlinks from a PDF.
        Returns a tuple: (full_text, list_of_hyperlinks)
        """
        full_text_parts = []
        hyperlinks_set: Set[str] = set()

        if pymupdf_available:
            try:
                pdf_document = fitz.open(stream=file_bytes, filetype="pdf")
                for page_num in range(len(pdf_document)):
                    page = pdf_document.load_page(page_num)
                    full_text_parts.append(page.get_text("text"))
                    links = page.get_links()
                    for link in links:
                        if link.get('uri'):
                            hyperlinks_set.add(link['uri'])
                pdf_document.close()
                logger.info(f"PyMuPDF: Extracted text and {len(hyperlinks_set)} unique hyperlinks from PDF.")
            except Exception as e:
                logger.error(f"Error extracting text/hyperlinks from PDF using PyMuPDF: {e}", exc_info=True)
                # Fallback to PyPDF2 for text if PyMuPDF fails unexpectedly after being found
                if pypdf2_available:
                    logger.info("PyMuPDF failed, attempting fallback to PyPDF2 for text extraction.")
                    try:
                        pdf_file = BytesIO(file_bytes)
                        reader = PdfReader(pdf_file)
                        for page_num in range(len(reader.pages)):
                            page = reader.pages[page_num]
                            page_text = page.extract_text()
                            if page_text:
                                full_text_parts.append(page_text)
                        logger.info("PyPDF2 fallback: Successfully extracted text.")
                    except Exception as e2:
                        logger.error(f"PyPDF2 fallback also failed: {e2}", exc_info=True)
                else:
                    return "", []  # No PDF library worked for text
        elif pypdf2_available:  # Only PyPDF2 is available
            try:
                pdf_file = BytesIO(file_bytes)
                reader = PdfReader(pdf_file)
                for page_num in range(len(reader.pages)):
                    page = reader.pages[page_num]
                    page_text = page.extract_text()
                    if page_text:
                        full_text_parts.append(page_text)
                logger.info(
                    "PyPDF2: Successfully extracted text (hyperlink extraction not supported by PyPDF2 directly).")
            except Exception as e:
                logger.error(f"Error extracting text from PDF using PyPDF2: {e}", exc_info=True)
                return "", []
        else:
            logger.error("No suitable PDF library (PyMuPDF or PyPDF2) available for PDF processing.")
            return "", []

        final_text = "\n".join(full_text_parts)
        # Basic text cleaning that might help URL regex later
        final_text = final_text.replace(" \n", "\n").replace("\n ", "\n")
        final_text = re.sub(r'(?<=[a-zA-Z0-9/])\s*\n\s*(?=[a-zA-Z0-9/])', '',
                            final_text)  # Join lines broken mid-URL/word

        return final_text, list(hyperlinks_set)

    @staticmethod
    def extract_text_from_docx(file_bytes: bytes) -> str:
        if not docx_available:
            logger.error("python-docx is not available for DOCX text extraction.")
            return ""
        try:
            doc_file = BytesIO(file_bytes)
            document = docx.Document(doc_file)
            text = "\n".join([para.text for para in document.paragraphs])
            logger.info(f"Successfully extracted raw text from DOCX (length: {len(text)}).")
            return text
        except Exception as e:
            logger.error(f"Error extracting raw text from DOCX: {e}", exc_info=True)
            return ""

    @staticmethod
    def extract_urls_from_text(text: str) -> List[str]:
        """Extracts URLs that are visibly written as text, including common domains without schemes."""
        if not text:
            return []

        # Pattern 1: For URLs explicitly starting with http(s):// or www.
        # This pattern tries to handle balanced parentheses and avoid inclusion of trailing punctuation.
        url_pattern_explicit = re.compile(
            r'\b(?:(?:https?://|www\.)[^\s<>()"]+(?:\([^\s<>()"]+\)|[^\s`!()\[\]{};:\'".,<>?«»“”‘’]))',
            re.IGNORECASE
        )

        # Pattern 2: For common professional/social domains often written without a scheme.
        # Each match from these will be prefixed with "https://".
        # The path part (?:/(?:[^\s<>()"])*)? means an optional group starting with /
        # followed by zero or more characters that are not spaces, parens, or quotes.
        implicit_url_patterns = [
            re.compile(r'\bgithub\.com(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\blinkedin\.com/(?:in|pub|company)(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bgitlab\.com(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bbitbucket\.org(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bstackoverflow\.com/users(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bmedium\.com/@?[^\s<>()"]*', re.IGNORECASE),  # Allows for @username or publication paths
            re.compile(r'\bdev\.to(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bbehance\.net(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bdribbble\.com(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\btwitter\.com(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bx\.com(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),  # For X (formerly Twitter)
            re.compile(r'\bkaggle\.com(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bleetcode\.com(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bhackerrank\.com(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(r'\bangel\.co(?:/(?:[^\s<>()"])*)?', re.IGNORECASE),
            re.compile(
                r'\b(?:myportfolio|personalblog|mywebsite|portfolio|blog)\.(?:com|io|me|dev|page|site|tech|online|link)(?:/(?:[^\s<>()"])*)?',
                re.IGNORECASE)
        ]

        email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
        text_without_emails = email_pattern.sub(' ', text)

        found_urls_set: Set[str] = set()

        # Process explicit URLs (Pattern 1)
        explicit_matches = url_pattern_explicit.findall(text_without_emails)
        for url in explicit_matches:
            processed_url = url.strip()
            if processed_url.startswith('www.'):
                processed_url = 'https://' + processed_url  # Default to https for www
            found_urls_set.add(processed_url)

        # Process implicit URLs (Pattern 2)
        for pattern in implicit_url_patterns:
            implicit_matches = pattern.findall(text_without_emails)
            for url_match in implicit_matches:
                processed_url = 'https://' + url_match.strip()
                found_urls_set.add(processed_url)

        final_cleaned_urls: Set[str] = set()
        # Stricter set of trailing characters to strip. Avoids stripping valid URL path end characters.
        trailing_punctuation_to_strip = '.,;:!?'  # Question mark can be part of query params, but less likely as pure trailing punctuation.
        # Parentheses and quotes are handled more carefully.

        for url in found_urls_set:
            temp_url = url

            # Strip common trailing punctuation iteratively
            while temp_url and temp_url[-1] in trailing_punctuation_to_strip:
                temp_url = temp_url[:-1]

            # Handle trailing parentheses or quotes more carefully
            # If URL ends with ')' and has an unbalanced '(', strip ')'
            # Example: "See (example.com/page)." -> "example.com/page"
            if temp_url.endswith(')') and temp_url.count('(') < temp_url.count(')'):
                temp_url = temp_url[:-1]
            # Similar for other paired characters if needed (e.g. ']', '"')
            if temp_url.endswith('"') and temp_url.count('"') % 2 != 0:  # Unbalanced quote
                # Find the last non-quote character before the trailing quote(s)
                m = re.search(r'[^\"]', temp_url)
                if m:  # if url is not all quotes
                    last_char_before_quote = temp_url.rfind('"', 0, len(temp_url) - 1)  # find previous quote
                    if last_char_before_quote == -1 or temp_url.count('"', 0,
                                                                      last_char_before_quote + 1) % 2 == 0:  # if no previous quote or previous quotes are balanced
                        temp_url = temp_url[:-1]  # strip trailing quote

            if len(temp_url) > 7 and '.' in temp_url and not temp_url.endswith("://"):
                if not (temp_url.startswith("http") and temp_url.endswith("@")):  # Avoid "http://user@"
                    final_cleaned_urls.add(temp_url)

        logger.info(
            f"Extracted {len(final_cleaned_urls)} unique text-based URLs from raw text after cleaning. Preview: {sorted(list(final_cleaned_urls))[:5]}")
        return sorted(list(final_cleaned_urls))

    def extract_all_urls(self, file_bytes: bytes, file_name: str) -> List[str]:
        """
        Extracts all URLs from a file: embedded hyperlinks (PDFs) and text-based URLs.
        """
        lower_file_name = file_name.lower()
        raw_text = ""
        embedded_hyperlinks: List[str] = []

        if lower_file_name.endswith('.pdf'):
            raw_text, embedded_hyperlinks = self.extract_text_and_hyperlinks_from_pdf(file_bytes)
        elif lower_file_name.endswith(('.doc', '.docx')):
            raw_text = self.extract_text_from_docx(file_bytes)
            logger.info("DOC/DOCX hyperlink extraction not implemented, relying on text-based URL extraction.")
        else:
            try:
                raw_text = file_bytes.decode('utf-8', errors='ignore')
            except Exception as e:
                logger.warning(f"Could not decode file {file_name} as text: {e}")
                raw_text = ""

        text_based_urls = self.extract_urls_from_text(raw_text)

        all_urls_set = set()
        for url in embedded_hyperlinks:
            if url and url.strip():  # Ensure embedded links are not empty/whitespace
                all_urls_set.add(url.strip())

        for url in text_based_urls:  # text_based_urls are already processed
            all_urls_set.add(url)

        final_url_list = sorted(list(all_urls_set))
        logger.info(
            f"Total {len(final_url_list)} unique URLs extracted from {file_name} (embedded + text-based). Preview: {final_url_list[:10]}")
        return final_url_list