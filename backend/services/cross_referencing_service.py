# services/cross_referencing_service.py
import logging
import httpx
import asyncio
from typing import List, Dict, Any, Optional, Set, Tuple  # Added Tuple
from urllib.parse import urlparse, unquote
import re
from Levenshtein import ratio as levenshtein_ratio  # Still useful for non-GitHub or fallback
import json
import os
import base64  # For decoding README content from GitHub API

from services.gemini_service import GeminiService
from models.cross_referencing import URLValidationDetail, EntityVerificationDetail, CrossReferencingResult

logger = logging.getLogger(__name__)

# Regex for GitHub username/repo from URL: Group 1 is owner, Group 2 (optional) is repo name
GITHUB_USER_REPO_FROM_URL_REGEX = re.compile(r"github\.com/([^/?#]+)(?:/([^/?#]+))?", re.IGNORECASE)
PAGE_TITLE_REGEX = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


# The following regexes were mentioned in _extract_name_from_social_title_or_url
# but not defined in the provided snippet. Assuming they might be defined elsewhere
# or are secondary to API-based extraction for GitHub.
# Their usage is commented out to ensure the provided code is runnable.
# GITHUB_PROFILE_NAME_FROM_SPAN_REGEX = re.compile(r'<span[^>]+itemprop=["\']name["\'][^>]*>([^<]+)</span>', re.IGNORECASE)
# GITHUB_OG_TITLE_NAME_REGEX = re.compile(r'<meta property="og:title" content="([^"]+)">', re.IGNORECASE)
# GITHUB_USERNAME_FROM_SPAN_REGEX = re.compile(r'<span[^>]+itemprop=["\']additionalName["\'][^>]*>([^<]+)</span>', re.IGNORECASE)


class CrossReferencingService:
    def __init__(self, gemini_service: Optional[GeminiService] = None):
        self.gemini_service = gemini_service if gemini_service else GeminiService()
        self.http_timeout = httpx.Timeout(20.0, connect=10.0)
        self.common_social_domains = ["linkedin.com", "github.com", "gitlab.com", "behance.net", "dribbble.com"]
        self.github_api_token = os.getenv("GITHUB_API_TOKEN")
        self.github_api_headers = {
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
        if self.github_api_token:
            self.github_api_headers['Authorization'] = f'Bearer {self.github_api_token}'
        else:
            logger.warning(
                "GITHUB_API_TOKEN not set. GitHub API requests will be unauthenticated and heavily rate-limited.")

        self.browser_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'DNT': '1',
            'Sec-GPC': '1',
        }

    async def _get_github_readme_content(self, owner: str, repo: str, client: httpx.AsyncClient) -> Optional[str]:
        """Fetches and decodes README content for a GitHub repository."""
        readme_url = f"https://api.github.com/repos/{owner}/{repo}/readme"
        logger.info(f"Fetching README for {owner}/{repo} from {readme_url}")
        try:
            response = await client.get(readme_url, headers=self.github_api_headers, timeout=self.http_timeout)
            if response.status_code == 200:
                readme_data = response.json()
                if readme_data.get("encoding") == "base64" and readme_data.get("content"):
                    decoded_content = base64.b64decode(readme_data["content"]).decode('utf-8', errors='replace')
                    logger.info(f"Successfully fetched and decoded README for {owner}/{repo}")
                    return decoded_content
                else:
                    logger.warning(f"README for {owner}/{repo} has unexpected encoding or no content.")
            elif response.status_code == 404:  # README not found is a valid case
                logger.info(f"No README found for {owner}/{repo} (404).")
            else:
                logger.warning(
                    f"Failed to fetch README for {owner}/{repo}. Status: {response.status_code}, Response: {response.text[:200]}")
        except Exception as e:
            logger.error(f"Error fetching README for {owner}/{repo}: {e}", exc_info=True)
        return None

    async def _verify_github_url_with_api(self, url: str, client: httpx.AsyncClient,
                                          resume_projects_paragraph: Optional[str]) -> Dict[str, Any]:
        api_result = {
            "is_live": False, "status_code": None,
            "extracted_name": None, "entity_type": None,
            # extracted_name is display name for user, or full_name for repo
            "description": None, "error_message": None,  # description is bio for user, or description for repo
            "api_data": None, "owner_login": None,  # owner_login is login for user, or owner.login for repo
            "project_similarity_score": 0.0
        }
        match = GITHUB_USER_REPO_FROM_URL_REGEX.search(url)
        if not match:
            api_result["error_message"] = "URL does not match GitHub user/repo pattern"
            return api_result

        owner, repo_name_segment = match.groups()
        owner = unquote(owner) if owner else None
        repo_name = unquote(repo_name_segment) if repo_name_segment else None

        if not owner:
            api_result["error_message"] = "Could not parse owner from GitHub URL"
            return api_result

        api_url = f"https://api.github.com/repos/{owner}/{repo_name}" if repo_name else f"https://api.github.com/users/{owner}"
        api_result["entity_type"] = "repository" if repo_name else "user"

        for attempt in range(2):  # Max 2 attempts (initial + 1 retry)
            try:
                logger.info(f"Verifying GitHub {api_result['entity_type']} via API: {api_url} (Attempt {attempt + 1})")
                response = await client.get(api_url, headers=self.github_api_headers, timeout=self.http_timeout)
                api_result["status_code"] = response.status_code

                if response.status_code == 200:
                    api_result["is_live"] = True
                    data = response.json()
                    api_result["api_data"] = data
                    if api_result["entity_type"] == "repository":
                        api_result["extracted_name"] = data.get("full_name")  # "owner/repo"
                        api_result["description"] = data.get("description")
                        api_result["owner_login"] = data.get("owner", {}).get("login")

                        if repo_name and resume_projects_paragraph:
                            readme_content = await self._get_github_readme_content(owner, repo_name, client)
                            repo_text_for_comparison = (api_result["description"] or "") + "\n" + (readme_content or "")
                            if repo_text_for_comparison.strip():
                                similarity = await self._compare_repo_with_resume_project(
                                    owner, repo_name, repo_text_for_comparison.strip(), resume_projects_paragraph
                                )
                                api_result["project_similarity_score"] = similarity
                    else:  # user or organization
                        api_result["extracted_name"] = data.get("name") or data.get(
                            "login")  # User's display name or login
                        api_result["description"] = data.get("bio")
                        api_result["owner_login"] = data.get("login")  # User's login/username
                        if data.get("type") == "Organization":
                            api_result["entity_type"] = "organization"
                    logger.info(
                        f"GitHub API success for {url}. Type: {api_result['entity_type']}, Extracted Name/ID: {api_result['extracted_name']}, Login: {api_result['owner_login']}")
                    logger.info(
                        f"... Project Similarity Score: {api_result['project_similarity_score']:.2f}")
                    break
                elif response.status_code == 404:
                    api_result["error_message"] = f"GitHub {api_result['entity_type']} not found via API (404)"
                    break
                elif response.status_code == 403:
                    # Try to parse rate limit reset time if available
                    reset_time = response.headers.get('X-RateLimit-Reset')
                    msg = "GitHub API rate limit/forbidden (403)"
                    if reset_time:
                        try:
                            msg += f". Limit resets at {datetime.fromtimestamp(int(reset_time)).isoformat()}"
                        except:
                            pass  # Ignore parsing errors
                    api_result["error_message"] = msg
                    logger.warning(f"{msg} for {url}")
                    break  # Don't retry on 403 unless it's a temporary block we can wait out (not implemented here)
                else:
                    api_result["error_message"] = f"GitHub API error (Status: {response.status_code})"
                    if attempt == 1:
                        logger.warning(
                            f"GitHub API error for {url} after 2 attempts: {response.status_code} - {response.text[:200]}")
                    else:
                        logger.info(
                            f"GitHub API error {response.status_code} for {url}, retrying...");
                        await asyncio.sleep(
                            1.5 * (attempt + 1))
                if attempt == 1 and not api_result["is_live"]: break

            except (httpx.ReadError, httpx.TimeoutException, httpx.RequestError) as e:
                api_result["error_message"] = f"GitHub API {type(e).__name__}: {str(e)}"
                logger.warning(f"GitHub API {type(e).__name__} for {url} (Attempt {attempt + 1}): {e}")
                if attempt == 1: break
                await asyncio.sleep(1.5 * (attempt + 1))
            except json.JSONDecodeError:
                api_result["error_message"] = "Failed to decode GitHub API JSON response"
                logger.warning(f"JSONDecodeError for GitHub API response from {url} (Attempt {attempt + 1})")
                break
            except Exception as e:
                logger.error(f"Unexpected error verifying GitHub URL {url} via API (Attempt {attempt + 1}): {e}",
                             exc_info=True)
                api_result["error_message"] = f"Unexpected API error: {type(e).__name__}"
                break
        return api_result

    async def _fetch_url_details(self, client: httpx.AsyncClient, url: str) -> Dict[str, Any]:
        result = {"is_live": False, "status_code": None, "extracted_page_title": None, "error_message": None,
                  "html_content": None}
        try:
            headers = self.browser_headers.copy()
            parsed_url = urlparse(url)
            # For social domains, sometimes 'cross-site' helps, but can also be problematic.
            # GitHub API is preferred, so this HTML fetch is mainly for non-GitHub or as extreme fallback.
            if parsed_url.hostname and any(domain in parsed_url.hostname for domain in
                                           self.common_social_domains) and "github.com" not in parsed_url.hostname:
                headers['Sec-Fetch-Site'] = 'cross-site'

            logger.debug(f"Fetching URL (HTML) {url}")
            response = await client.get(url, timeout=self.http_timeout, follow_redirects=True, headers=headers)
            result["status_code"] = response.status_code

            try:
                # Try to decode with detected encoding, fallback to utf-8, then replace errors
                content_bytes = response.content
                detected_encoding = response.encoding or 'utf-8'
                result["html_content"] = content_bytes.decode(detected_encoding, errors='replace')
            except Exception as e_decode:
                logger.warning(
                    f"Could not decode response content for {url} with {detected_encoding}: {e_decode}. Falling back to response.text.");
                result["html_content"] = response.text  # response.text handles decoding internally

            if 200 <= response.status_code < 300:
                result["is_live"] = True
                if result["html_content"]:
                    title_match = PAGE_TITLE_REGEX.search(result["html_content"])
                    if title_match:
                        result["extracted_page_title"] = title_match.group(1).strip().replace('\n', ' ').replace('\r',
                                                                                                                 '')
                    else:
                        result["extracted_page_title"] = "Title not found in HTML"
                else:
                    result["extracted_page_title"] = "No HTML content received"  # Should be rare if status is 200
            elif response.status_code == 999 and "linkedin.com" in url:  # LinkedIn specific block
                result["error_message"] = "LinkedIn request blocked (Status 999)";
                logger.warning(f"LinkedIn returned 999 for {url}")
            else:
                result["error_message"] = f"HTTP Status {response.status_code}";
                logger.warning(
                    f"Failed to fetch {url} with status {response.status_code}")

        except httpx.TimeoutException:
            result["error_message"] = "Request timed out"
        except httpx.ConnectError:
            result["error_message"] = "Connection error"
        except httpx.TooManyRedirects:
            result["error_message"] = "Too many redirects"
        except httpx.RequestError as e:
            result["error_message"] = f"Request error: {type(e).__name__} - {str(e)}"
        except Exception as e:
            result["error_message"] = f"Fetch error: {type(e).__name__}";
            logger.warning(
                f"Generic fetch error for {url}: {e}", exc_info=True)
        return result

    def _extract_name_from_social_title_or_url(self, page_title: Optional[str], url: str,
                                               html_content: Optional[str] = None,
                                               github_api_data: Optional[Dict[str, Any]] = None) -> Optional[str]:
        if not url: return None
        parsed_url = urlparse(url)
        domain = parsed_url.hostname.lower() if parsed_url.hostname else ""

        logger.debug(
            f"Extracting name for URL: {url}, Domain: {domain}, Title: {page_title}, Has GH API Data: {github_api_data is not None}")

        if "github.com" in domain:
            if github_api_data and github_api_data.get("extracted_name"):  # API data is preferred
                return github_api_data.get("extracted_name")  # This is display name for user, full_name for repo

            # Fallback HTML/Title parsing for GitHub - less likely to be hit if API is primary
            if html_content:
                # name_span_match = GITHUB_PROFILE_NAME_FROM_SPAN_REGEX.search(html_content) # Commented out
                # if name_span_match: return name_span_match.group(1).strip()
                # og_title_meta_match = GITHUB_OG_TITLE_NAME_REGEX.search(html_content) # Commented out
                # if og_title_meta_match:
                #     og_title_content = og_title_meta_match.group(1)
                #     name_in_parens_match = re.match(r"^(.*?)\s+\(([^)]+)\)$", og_title_content)
                #     if name_in_parens_match: return name_in_parens_match.group(1).strip()
                #     if og_title_content.strip(): return og_title_content.strip()
                # username_span_match = GITHUB_USERNAME_FROM_SPAN_REGEX.search(html_content) # Commented out
                # if username_span_match: return username_span_match.group(1).strip()
                pass  # Regexes commented out

            # Fallback to URL parsing for GitHub username if other methods fail
            url_match = GITHUB_USER_REPO_FROM_URL_REGEX.search(url)
            if url_match:
                owner_from_url = url_match.group(1)
                repo_from_url = url_match.group(2)
                if repo_from_url:
                    return f"{owner_from_url}/{repo_from_url}"  # owner/repo
                return owner_from_url  # owner (username)

            # Fallback to page title parsing for GitHub
            if page_title:
                name = page_title.split('·')[0].strip()
                return name if name.lower() != "github" else None

        if "linkedin.com" in domain:
            if page_title:
                name_match = re.search(r"^([^|-]+)", page_title)
                if name_match:
                    extracted_name = name_match.group(1).strip()
                    generic_linkedin_titles = ["linkedin", "log in or sign up", "people search", "jobs", "content feed",
                                               "unavailable", "cookie policy", "999: request failed"]
                    # More robust check for generic titles
                    if not any(gen_title in extracted_name.lower() for gen_title in generic_linkedin_titles) and \
                            len(extracted_name) > 3 and \
                            not extracted_name.lower().startswith("view ") and \
                            not extracted_name.lower().endswith("’s profile"):
                        return extracted_name
            # Try extracting from URL path for LinkedIn (e.g., /in/john-doe)
            path_segments = [seg for seg in parsed_url.path.strip('/').split('/') if seg]
            if "in" in path_segments:
                try:
                    in_index = path_segments.index("in")
                    if in_index + 1 < len(path_segments):
                        name_segment = path_segments[in_index + 1].split('?')[0]  # Remove query params
                        # Decode URL-encoded characters and replace hyphens
                        decoded_name = unquote(name_segment).replace('-', ' ').replace('%20', ' ').title()
                        if len(decoded_name) > 2 and not any(char.isdigit() for char in decoded_name[
                                                                                        -4:]):  # Avoid trailing numbers if they seem like IDs
                            return decoded_name
                except ValueError:
                    pass  # "in" not found or segment not as expected

        # Generic title cleaning for other domains or as a final fallback
        if page_title:
            temp_title = page_title
            common_suffixes_prefixes = [
                "| LinkedIn", " - LinkedIn", "LinkedIn", "| GitHub", " - GitHub", "GitHub", "· GitHub",
                "Profile", "Portfolio", "Resume", "CV", "| Behance", "on Behance", "| Dribbble", "on Dribbble",
                "| GitLab", "GitLab", "- Home", "Home Page"
            ]
            for sp in common_suffixes_prefixes:
                temp_title = re.sub(r'\s*' + re.escape(sp) + r'\s*$', '', temp_title,
                                    flags=re.IGNORECASE)  # End of string
                temp_title = re.sub(r'^\s*' + re.escape(sp) + r'\s*', '', temp_title,
                                    flags=re.IGNORECASE)  # Start of string

            temp_title = re.sub(r'^[\s|\-–—]+|[\s|\-–—]+$', '', temp_title).strip()  # Clean leading/trailing separators

            generic_page_names = ["home", "log in", "sign up", "welcome", "error", "unavailable", "page not found",
                                  "404", "redirecting", "title not found in html", "index"]
            # Check if the cleaned title is not generic and has a reasonable length
            if temp_title and len(temp_title.split()) <= 7 and temp_title.lower() not in generic_page_names and len(
                    temp_title) > 2:
                return temp_title

        logger.warning(f"Could not extract a specific name from URL {url}, title '{page_title}' using generic methods.")
        return None

    def _normalize_name(self, name: Optional[str]) -> str:
        if not name: return ""
        name = name.lower()
        # Remove common titles
        name = re.sub(r'\b(mr|ms|mrs|miss|dr|prof|phd|md|esq|jr|sr|ii|iii|iv)[\s.]*\b', '', name, flags=re.IGNORECASE)
        name = re.sub(r'[^\w\s-]', '', name)  # Keep alphanumeric, whitespace, and hyphens
        name = re.sub(r'\s+', ' ', name).strip()  # Normalize whitespace
        return name

    async def _compare_repo_with_resume_project(self, repo_owner: str, repo_name_str: str, repo_text_content: str,
                                                resume_project_description: str) -> float:
        """Compares a GitHub repo's text content with a resume project description using Gemini."""
        if not self.gemini_service:
            logger.warning("Gemini service not available for project comparison.")
            return 0.0
        if not repo_text_content or not resume_project_description:
            logger.debug("Repo content or resume project description is empty, skipping comparison.")
            return 0.0

        prompt = f"""
        Assess the semantic similarity between the following GitHub repository information and a project description from a resume.
        Consider the technologies, problem domain, and overall purpose.
        Provide a similarity score between 0.0 (no similarity) and 1.0 (very high similarity or identical).

        GitHub Repository:
        Owner/Name: {repo_owner}/{repo_name_str}
        Description/README content (first 2000 chars):
        {repo_text_content[:2000]} 

        Resume Project Description (first 2000 chars):
        {resume_project_description[:2000]}

        Return ONLY a JSON object with a single key "similarity_score" and its float value. Example: {{"similarity_score": 0.75}}
        """
        try:
            response_str = await self.gemini_service.generate_text(prompt)
            # Clean potential markdown code block fences
            cleaned_response_str = response_str.strip()
            if cleaned_response_str.startswith("```json"):
                cleaned_response_str = cleaned_response_str[len("```json"):]
            if cleaned_response_str.startswith("```"):
                cleaned_response_str = cleaned_response_str[len("```"):]
            if cleaned_response_str.endswith("```"):
                cleaned_response_str = cleaned_response_str[:-len("```")]
            cleaned_response_str = cleaned_response_str.strip()

            data = json.loads(cleaned_response_str)
            score = float(data.get("similarity_score", 0.0))
            # Ensure score is within bounds
            score = max(0.0, min(1.0, score))
            logger.info(f"Gemini similarity for repo {repo_owner}/{repo_name_str} and resume project: {score}")
            return score
        except json.JSONDecodeError as e:
            logger.error(
                f"JSONDecodeError comparing repo {repo_owner}/{repo_name_str} with resume project. Response: '{cleaned_response_str}'. Error: {e}")
        except Exception as e:
            logger.error(f"Error comparing repo {repo_owner}/{repo_name_str} with resume project: {e}", exc_info=True)
        return 0.0  # Default to no similarity on error

    async def validate_urls(self, urls: List[str], candidate_name_on_resume: Optional[str],
                            resume_projects_paragraph: Optional[str] = None) -> List[URLValidationDetail]:
        url_details_list: List[URLValidationDetail] = []
        if not urls: return url_details_list
        unique_urls = sorted(list(set(u for u in urls if u and u.strip())))

        async with httpx.AsyncClient(http2=True, trust_env=False, timeout=self.http_timeout) as client:
            tasks_map: Dict[str, asyncio.Task] = {}
            for url_to_validate in unique_urls:
                parsed_url_obj = urlparse(url_to_validate)
                if parsed_url_obj.hostname and "github.com" in parsed_url_obj.hostname.lower():
                    tasks_map[url_to_validate] = asyncio.create_task(
                        self._verify_github_url_with_api(url_to_validate, client, resume_projects_paragraph)
                    )
                else:
                    tasks_map[url_to_validate] = asyncio.create_task(
                        self._fetch_url_details(client, url_to_validate)
                    )

            # Ensure tasks are scheduled before awaiting
            if tasks_map:
                await asyncio.sleep(0)

            for url_to_process in unique_urls:
                detail = URLValidationDetail(url=url_to_process, is_live=False, validation_notes="")
                try:
                    process_res = await tasks_map[url_to_process]
                except Exception as task_exc:
                    logger.error(f"Task for URL {url_to_process} failed directly: {task_exc}", exc_info=True)
                    process_res = {"error_message": f"Task execution error: {str(task_exc)}", "is_live": False,
                                   "status_code": None}

                detail.is_live = process_res.get("is_live", False)
                detail.status_code = process_res.get("status_code")
                detail.error_message = process_res.get("error_message")

                current_url_parsed = urlparse(url_to_process)
                is_github_url = current_url_parsed.hostname and "github.com" in current_url_parsed.hostname.lower()

                if is_github_url:
                    # GitHub specific processing (uses results from _verify_github_url_with_api)
                    detail.extracted_page_title = process_res.get(
                        "extracted_name")  # User's display name or repo's full_name
                    entity_type_from_api = process_res.get("entity_type", "resource")
                    item_description_from_api = process_res.get("description")  # Repo desc or user bio
                    github_login_identifier = process_res.get("owner_login")  # User login or repo owner login

                    if detail.is_live:
                        detail.validation_notes = f"GitHub API: Valid {entity_type_from_api}."
                        if github_login_identifier:
                            detail.validation_notes += f" Login/Owner: {github_login_identifier}."

                        if detail.extracted_page_title and detail.extracted_page_title != github_login_identifier:
                            detail.validation_notes += f" Profile Name/Repo ID: {detail.extracted_page_title}."

                        if entity_type_from_api == "repository":
                            detail.extracted_profile_name = github_login_identifier  # Store owner for info, not for direct name scoring
                            if item_description_from_api:
                                detail.validation_notes += f" Desc: {item_description_from_api[:70]}..."
                            sim_score = process_res.get("project_similarity_score")
                            if sim_score is not None:
                                detail.project_similarity_score = float(process_res.get("project_similarity_score", 0.0))
                                detail.validation_notes += f" Project Match (README vs Resume): {detail.project_similarity_score:.2f}."
                            # For repositories, owner name vs. resume name match is not a primary signal.
                            detail.validation_notes += " (Repo owner name not scored against resume name)."

                        elif entity_type_from_api in ["user", "organization"]:
                            # For user/org profiles, compare login and display name (if different) with resume name
                            detail.extracted_profile_name = github_login_identifier  # Primarily the login/username
                            if candidate_name_on_resume and github_login_identifier:
                                norm_resume = self._normalize_name(candidate_name_on_resume)

                                scores_and_sources = []  # Store (score, source_name)

                                # Compare login name
                                norm_login = self._normalize_name(github_login_identifier)
                                if norm_login and norm_resume:
                                    login_match_score = levenshtein_ratio(norm_login, norm_resume)
                                    scores_and_sources.append((login_match_score, github_login_identifier, "username"))

                                # Compare display name if different from login
                                github_display_name = detail.extracted_page_title  # Already fetched
                                if github_display_name and github_display_name.lower() != github_login_identifier.lower():
                                    norm_display = self._normalize_name(github_display_name)
                                    if norm_display and norm_resume:
                                        display_match_score = levenshtein_ratio(norm_display, norm_resume)
                                        scores_and_sources.append(
                                            (display_match_score, github_display_name, "display name"))

                                if scores_and_sources:
                                    # Sort by score descending to pick the best match
                                    scores_and_sources.sort(key=lambda x: x[0], reverse=True)
                                    detail.name_match_score = scores_and_sources[0][0]
                                    best_match_name = scores_and_sources[0][1]
                                    best_match_type = scores_and_sources[0][2]
                                    detail.validation_notes += f" Best GitHub {best_match_type} match ('{best_match_name}' vs '{candidate_name_on_resume}'): {detail.name_match_score:.2f}."
                                else:
                                    detail.validation_notes += " Could not normalize GitHub names for comparison with resume name."
                                detail.validation_notes += " (Note: GitHub names/usernames can differ from resume names)."
                                detail.name_on_resume_for_comparison = candidate_name_on_resume

                            elif github_login_identifier:  # No resume name to compare against
                                detail.validation_notes += f" GitHub Login: '{github_login_identifier}'."
                                if detail.extracted_page_title and detail.extracted_page_title != github_login_identifier:
                                    detail.validation_notes += f" Profile Name: '{detail.extracted_page_title}'."

                    elif detail.error_message:  # Not live (GitHub)
                        detail.validation_notes = f"GitHub API: {detail.error_message}."
                        if github_login_identifier:
                            detail.validation_notes += f" (Attempted for {github_login_identifier or entity_type_from_api})."
                    else:  # Not live, no specific error (GitHub)
                        detail.validation_notes = "GitHub API: Unknown status."
                        if github_login_identifier:
                            detail.validation_notes += f" (Attempted for {github_login_identifier or entity_type_from_api})."

                # Non-GitHub URL processing (uses results from _fetch_url_details)
                elif detail.is_live:
                    detail.extracted_page_title = process_res.get("extracted_page_title")
                    html_content = process_res.get("html_content")
                    extracted_name_for_comparison = self._extract_name_from_social_title_or_url(
                        detail.extracted_page_title, url_to_process, html_content, None
                        # github_api_data is None for non-GH
                    )
                    detail.validation_notes = f"URL is live (Status: {detail.status_code})."
                    if extracted_name_for_comparison:
                        detail.extracted_profile_name = extracted_name_for_comparison
                        if candidate_name_on_resume:
                            detail.name_on_resume_for_comparison = candidate_name_on_resume
                            norm_extracted = self._normalize_name(extracted_name_for_comparison)
                            norm_resume = self._normalize_name(candidate_name_on_resume)
                            if norm_extracted and norm_resume:
                                detail.name_match_score = levenshtein_ratio(norm_extracted, norm_resume)
                                detail.validation_notes += f" Name Match with '{candidate_name_on_resume}': {detail.name_match_score:.2f}."
                                logger.info(
                                    f"Name match score for {url_to_process}: {detail.name_match_score:.2f} ('{norm_extracted}' vs '{norm_resume}')")
                            else:
                                detail.validation_notes += " Could not normalize names for comparison."
                        else:  # No resume name to compare against
                            detail.validation_notes += f" Extracted Name: '{extracted_name_for_comparison[:60]}'."
                    elif detail.extracted_page_title:
                        detail.validation_notes += f" Page Title: '{detail.extracted_page_title[:70]}'."
                    else:
                        detail.validation_notes += " Could not extract specific profile name or page title."

                # General error/status handling if not covered above
                if not detail.validation_notes:
                    if detail.error_message:
                        detail.validation_notes = detail.error_message
                    elif not detail.is_live:
                        detail.validation_notes = f"URL not live or no content (Status: {detail.status_code or 'Unknown'})."
                    elif detail.is_live:
                        detail.validation_notes = "URL is live, but no further details extracted."

                url_details_list.append(detail)
        return url_details_list

    async def _extract_entities_from_text_with_gemini(self, text_block: str, entity_type_to_extract: str) -> List[str]:
        if not self.gemini_service:
            logger.warning("Gemini service not available for entity extraction.")
            return []
        if not text_block or not text_block.strip(): return []
        prompt = f"""
From the following text block, extract a list of {entity_type_to_extract}.
Return ONLY a valid JSON array of strings, where each string is an identified name.
If no relevant entities are found, return an empty array [].
Do not include explanations or any other text outside the JSON array.

Text Block:
---
{text_block}
---

Example for "companies": ["Innovatech Ltd", "Global Solutions Inc", "Alpha Corp"]
Example for "educational institutions": ["State University", "Community College of Technology", "Online Learning Institute"]

JSON Array Output:
"""
        try:
            response_str = await self.gemini_service.generate_text(prompt)
            # Clean potential markdown code block fences
            cleaned_response_str = response_str.strip()
            if cleaned_response_str.startswith("```json"):
                cleaned_response_str = cleaned_response_str[len("```json"):]
            if cleaned_response_str.startswith("```"):
                cleaned_response_str = cleaned_response_str[len("```"):]
            if cleaned_response_str.endswith("```"):
                cleaned_response_str = cleaned_response_str[:-len("```")]
            cleaned_response_str = cleaned_response_str.strip()

            if not cleaned_response_str: return []

            # Try direct JSON parsing first
            if cleaned_response_str.startswith("[") and cleaned_response_str.endswith("]"):
                try:
                    extracted_list = json.loads(cleaned_response_str)
                    if isinstance(extracted_list, list) and all(isinstance(item, str) for item in extracted_list):
                        return list(set(name.strip() for name in extracted_list if name.strip()))
                except json.JSONDecodeError:
                    logger.warning(
                        f"Gemini non-JSON array for {entity_type_to_extract}: {cleaned_response_str[:200]}. Attempting fallback parsing.")

            # Fallback parsing (if not a perfect JSON array or if Gemini includes other text)
            items = []
            # Try to find JSON-like array within the response if it's embedded
            array_match = re.search(r'\[([^\]]*)\]', cleaned_response_str)
            if array_match:
                try:
                    potential_array_str = f"[{array_match.group(1)}]"
                    extracted_list = json.loads(potential_array_str)
                    if isinstance(extracted_list, list) and all(isinstance(item, str) for item in extracted_list):
                        return list(set(name.strip() for name in extracted_list if name.strip()))
                except json.JSONDecodeError:
                    pass  # Fall through to other methods

            # Extract items quoted
            quoted_items = re.findall(r'"([^"]+)"', cleaned_response_str)
            if quoted_items:
                items.extend(name.strip() for name in quoted_items if name.strip())

            # If no quoted items, or to supplement, try splitting by common delimiters
            # This is more risky if the response isn't just a list
            if not items or len(items) < 2:  # Try splitting if few/no quoted items
                # Remove example lines to avoid extracting "Example for..."
                text_to_split = re.sub(r'Example for.*?\n', '', cleaned_response_str, flags=re.IGNORECASE)
                text_to_split = re.sub(r'JSON Array Output.*?\n', '', text_to_split, flags=re.IGNORECASE)
                text_to_split = text_to_split.replace("[", "").replace("]", "").strip()  # Remove brackets

                possible_delimiters = re.compile(r'\s*,\s*|\s+and\s+|\s*;\s*|\n\s*-\s*|\n')
                split_items = possible_delimiters.split(text_to_split)
                items.extend(item.strip().removeprefix('-').strip() for item in split_items if
                             item and item.strip() and len(item.strip()) > 2)

            unique_items = list(
                set(item for item in items if item and len(item) > 1 and not item.lower().startswith("example")))
            if unique_items:
                logger.info(
                    f"Extracted {len(unique_items)} unique {entity_type_to_extract} using fallback parsing: {unique_items[:5]}")
                return unique_items

            logger.warning(
                f"Could not reliably parse entity list for {entity_type_to_extract} from Gemini response: {cleaned_response_str[:200]}")
            return []

        except Exception as e:
            logger.error(f"Error extracting {entity_type_to_extract} with Gemini: {e}", exc_info=True)
            return []

    async def _verify_single_entity_with_gemini(self, entity_name: str, entity_type: str) -> EntityVerificationDetail:
        detail = EntityVerificationDetail(entity_name=entity_name, entity_type=entity_type)
        if not self.gemini_service:
            logger.warning("Gemini service not available for entity verification.")
            detail.error_message = "AI verification service not available."
            detail.existence_confidence = 0.0
            return detail

        prompt = f"""
Is "{entity_name}" a known and verifiable {entity_type}?
Consider its typical online presence (e.g., official website, public records, news mentions).
Provide your answer in the following JSON format ONLY, with no other text or markdown:
{{
  "existence_confidence": 0.0_to_1.0,
  "verification_notes": "Brief note, e.g., 'Well-known public university with official website.' or 'Small company with a basic website, appears legitimate.' or 'No verifiable public information found for this specific name as a {entity_type}.'",
  "supporting_info_url": "If a primary official URL (e.g., company homepage, university main site) is easily found and seems authoritative, provide it. Otherwise, 'N/A'."
}}
"""
        try:
            response_str = await self.gemini_service.generate_text(prompt)
            # Clean potential markdown code block fences
            cleaned_response_str = response_str.strip()
            if cleaned_response_str.startswith("```json"):
                cleaned_response_str = cleaned_response_str[len("```json"):]
            if cleaned_response_str.startswith("```"):
                cleaned_response_str = cleaned_response_str[len("```"):]
            if cleaned_response_str.endswith("```"):
                cleaned_response_str = cleaned_response_str[:-len("```")]
            cleaned_response_str = cleaned_response_str.strip()

            data = json.loads(cleaned_response_str)
            detail.existence_confidence = data.get("existence_confidence")
            detail.verification_notes = data.get("verification_notes")
            detail.supporting_info_url = data.get("supporting_info_url")

            if detail.supporting_info_url and detail.supporting_info_url.lower() == "n/a":
                detail.supporting_info_url = None

            if detail.existence_confidence is None:
                detail.existence_confidence = 0.0
                detail.verification_notes = (detail.verification_notes or "") + " AI could not determine confidence."
            else:  # Ensure confidence is float and bounded
                try:
                    detail.existence_confidence = float(detail.existence_confidence)
                    detail.existence_confidence = max(0.0, min(1.0, detail.existence_confidence))
                except (ValueError, TypeError):
                    logger.warning(
                        f"Gemini returned non-float confidence for '{entity_name}': {data.get('existence_confidence')}")
                    detail.existence_confidence = 0.0
                    detail.verification_notes = (
                                                            detail.verification_notes or "") + " AI returned invalid confidence value."

        except json.JSONDecodeError as e:
            logger.error(
                f"JSONDecodeError verifying entity '{entity_name}' ({entity_type}) with Gemini. Response: '{cleaned_response_str}'. Error: {e}")
            detail.error_message = f"AI verification response parsing failed: {str(e)}"
            detail.existence_confidence = 0.0
        except Exception as e:
            logger.error(f"Error verifying entity '{entity_name}' ({entity_type}) with Gemini: {e}", exc_info=True)
            detail.error_message = f"AI verification failed: {str(e)}"
            detail.existence_confidence = 0.0
        return detail

    async def verify_entities_from_text(self, work_experience_paragraph: Optional[str],
                                        education_paragraph: Optional[str]) -> List[EntityVerificationDetail]:
        all_verified_entities: List[EntityVerificationDetail] = []
        unique_entity_names_to_verify: Set[Tuple[str, str]] = set()  # Using tuple (name, type)

        if work_experience_paragraph and work_experience_paragraph.strip():
            company_names = await self._extract_entities_from_text_with_gemini(work_experience_paragraph, "companies")
            for name in company_names:
                if name: unique_entity_names_to_verify.add((name.strip(), "company"))

        if education_paragraph and education_paragraph.strip():
            school_names = await self._extract_entities_from_text_with_gemini(education_paragraph,
                                                                              "educational institutions")
            for name in school_names:
                if name: unique_entity_names_to_verify.add((name.strip(), "education"))

        if not unique_entity_names_to_verify:
            return []

        tasks = [self._verify_single_entity_with_gemini(name, type_val) for name, type_val in
                 unique_entity_names_to_verify]

        if tasks:
            verification_results = await asyncio.gather(*tasks, return_exceptions=True)
            for i, res in enumerate(verification_results):
                # Ensure we're matching the original entity correctly
                # This relies on asyncio.gather preserving order, which it does.
                original_name, original_type = list(unique_entity_names_to_verify)[i]
                if isinstance(res, Exception):
                    logger.error(
                        f"Verification task for entity '{original_name}' ({original_type}) raised an exception: {res}")
                    all_verified_entities.append(
                        EntityVerificationDetail(entity_name=original_name, entity_type=original_type,
                                                 existence_confidence=0.0,
                                                 verification_notes="Verification task failed internally.",
                                                 error_message=str(res)))
                elif isinstance(res, EntityVerificationDetail):
                    all_verified_entities.append(res)
                else:  # Should not happen if tasks return EntityVerificationDetail or raise Exception
                    logger.error(
                        f"Unexpected result type from entity verification task for '{original_name}': {type(res)}")
                    all_verified_entities.append(
                        EntityVerificationDetail(entity_name=original_name, entity_type=original_type,
                                                 existence_confidence=0.0,
                                                 verification_notes="Verification task returned unexpected data.",
                                                 error_message="Unknown task result type"))
        return all_verified_entities

    async def run_all_checks(
            self,
            urls: List[str],
            candidate_name_on_resume: Optional[str],
            work_experience_paragraph: Optional[str] = None,
            education_paragraph: Optional[str] = None,
            pre_extracted_entities: Optional[List[Dict[str, str]]] = None,
            resume_projects_paragraph: Optional[str] = None
    ) -> CrossReferencingResult:
        final_result = CrossReferencingResult()

        # Create tasks
        url_validation_task = self.validate_urls(urls, candidate_name_on_resume, resume_projects_paragraph)

        entity_verification_from_text_task = self.verify_entities_from_text(
            work_experience_paragraph, education_paragraph
        )

        # Task for pre-extracted entities
        pre_extracted_entities_verification_tasks_list: List[asyncio.Task] = []
        if pre_extracted_entities:
            unique_pre_extracted_tuples: Set[Tuple[str, str]] = set()
            for item in pre_extracted_entities:
                name = item.get("name")
                type_val = item.get("type")
                if name and type_val:
                    unique_pre_extracted_tuples.add((name.strip(), type_val.strip().lower()))

            for name, type_val in unique_pre_extracted_tuples:
                pre_extracted_entities_verification_tasks_list.append(
                    self._verify_single_entity_with_gemini(name, type_val)
                )

        pre_extracted_gather_task = asyncio.gather(*pre_extracted_entities_verification_tasks_list,
                                                   return_exceptions=True) if pre_extracted_entities_verification_tasks_list else asyncio.Future()
        if not pre_extracted_entities_verification_tasks_list and isinstance(pre_extracted_gather_task, asyncio.Future):
            pre_extracted_gather_task.set_result([])

        # Gather results from all top-level tasks
        gathered_results = await asyncio.gather(
            url_validation_task,
            entity_verification_from_text_task,
            pre_extracted_gather_task,
            return_exceptions=True
        )

        # Process URL validation results
        url_results = gathered_results[0]
        if isinstance(url_results, Exception):
            final_result.cross_ref_module_error_message = (
                                                                      final_result.cross_ref_module_error_message or "") + "URL validation sub-module failed. "
            logger.error(f"URL validation task failed: {url_results}", exc_info=url_results)
            final_result.urls_validated = [
                URLValidationDetail(url=u, is_live=False, validation_notes="Validation task error.",
                                    error_message=str(url_results))
                for u in urls if u  # Create placeholders for all original URLs
            ]
        elif url_results is not None:  # Should be List[URLValidationDetail]
            final_result.urls_validated = url_results
        else:  # Should not happen if task returns a list or raises exception
            final_result.urls_validated = []

        # Combine and process entity verification results
        combined_entities: Dict[Tuple[str, str], EntityVerificationDetail] = {}

        def _process_entity_results_list(results_list: Optional[List[Any]], source_description: str):
            nonlocal combined_entities  # Allow modification of combined_entities from outer scope
            if results_list is None:
                logger.warning(f"{source_description} entity results list is None.")
                return

            if isinstance(results_list, Exception):
                logger.error(f"{source_description} entity verification sub-module failed: {results_list}",
                             exc_info=results_list)
                final_result.cross_ref_module_error_message = (
                                                                          final_result.cross_ref_module_error_message or "") + f"{source_description} entity verification failed. "
                return

            if not isinstance(results_list, list):
                logger.error(
                    f"Unexpected result type for {source_description} entity verification: {type(results_list)}")
                return

            for entity_detail_or_exc in results_list:
                if isinstance(entity_detail_or_exc, EntityVerificationDetail):
                    entity_detail = entity_detail_or_exc
                    # Key by normalized name and type to avoid duplicates from different sources/casing
                    key = (self._normalize_name(entity_detail.entity_name), entity_detail.entity_type.lower())
                    if not key[0]: continue  # Skip if normalized name is empty

                    # Prefer entities with higher confidence, or those without errors if current has error
                    if key not in combined_entities or \
                            (entity_detail.existence_confidence is not None and combined_entities[
                                key].existence_confidence is None) or \
                            (entity_detail.existence_confidence is not None and combined_entities[
                                key].existence_confidence is not None and \
                             entity_detail.existence_confidence > combined_entities[key].existence_confidence) or \
                            (entity_detail.error_message is None and combined_entities[key].error_message is not None):
                        combined_entities[key] = entity_detail

                elif isinstance(entity_detail_or_exc, Exception):
                    logger.error(
                        f"Individual entity verification failed in {source_description}: {entity_detail_or_exc}",
                        exc_info=entity_detail_or_exc)
                    # Optionally, create a placeholder EntityVerificationDetail with error if needed
                else:  # Should not happen
                    logger.warning(
                        f"Unexpected item type in {source_description} entity results: {type(entity_detail_or_exc)}")

        _process_entity_results_list(gathered_results[1], "Text-extracted")  # From verify_entities_from_text
        _process_entity_results_list(gathered_results[2], "Pre-extracted")  # From pre_extracted_entities

        final_result.entities_verified = list(combined_entities.values())

        # Calculate overall scores
        url_scores = [res.name_match_score for res in final_result.urls_validated if
                      res.is_live and res.name_match_score is not None]
        avg_url_name_match = sum(url_scores) / len(
            url_scores) if url_scores else 0.0  # If no scores, 0.0 to avoid penalty if no names to match

        live_url_count = sum(1 for res in final_result.urls_validated if res.is_live)
        total_urls_attempted = len(final_result.urls_validated)
        live_url_ratio = live_url_count / total_urls_attempted if total_urls_attempted > 0 else 0.0

        # URL module score: 40% live ratio, 60% name match (if names were available for matching)
        # If no URLs were provided, score is 1.0 (neutral)
        if not final_result.urls_validated:
            url_module_score = 1.0
        else:
            # If there were URLs but none had name matches (e.g. all repos, or no resume name), avg_url_name_match is 0.
            # We should consider if avg_url_name_match should be 1.0 if no names were expected to match.
            # For now, stick to the formula.
            url_module_score = (live_url_ratio * 0.4) + (avg_url_name_match * 0.6)

        entity_confidences = [res.existence_confidence for res in final_result.entities_verified if
                              res.existence_confidence is not None]
        avg_entity_confidence = sum(entity_confidences) / len(entity_confidences) if entity_confidences else 0.0

        # Determine if entity checks were actually performed
        had_entities_to_check = bool(final_result.entities_verified) or \
                                bool(work_experience_paragraph and work_experience_paragraph.strip()) or \
                                bool(education_paragraph and education_paragraph.strip()) or \
                                bool(pre_extracted_entities)

        # Entity module score: average confidence. If no entities to check, score is 1.0 (neutral)
        entity_module_score = avg_entity_confidence if had_entities_to_check and entity_confidences else 1.0
        if had_entities_to_check and not entity_confidences and not final_result.entities_verified:  # entities were expected but none found/verified
            entity_module_score = 0.0  # Penalize if entities were expected but failed to verify or extract

        # Combine module scores for overall score
        if final_result.urls_validated and had_entities_to_check:
            final_result.overall_cross_ref_score = (url_module_score * 0.5) + (entity_module_score * 0.5)
        elif final_result.urls_validated:  # Only URL checks were relevant/performed
            final_result.overall_cross_ref_score = url_module_score
        elif had_entities_to_check:  # Only entity checks were relevant/performed
            final_result.overall_cross_ref_score = entity_module_score
        else:  # No checks performed (no URLs, no text for entities)
            final_result.overall_cross_ref_score = 1.0  # Neutral score

        final_result.overall_cross_ref_score = round(max(0.0, min(1.0, final_result.overall_cross_ref_score or 0.0)), 3)

        # Summary notes
        notes = []
        if final_result.urls_validated:
            notes.append(f"{live_url_count}/{total_urls_attempted} URLs live.")
            # Add project similarity summary if any
            project_match_scores = [res.project_similarity_score for res in final_result.urls_validated if
                                    res.project_similarity_score > 0.0]
            if project_match_scores:
                avg_project_match = sum(project_match_scores) / len(project_match_scores)
                notes.append(f"Avg GitHub project match: {avg_project_match:.2f} ({len(project_match_scores)} repos).")

        if final_result.entities_verified:
            verified_count = sum(1 for r_val in final_result.entities_verified if
                                 r_val.existence_confidence is not None and r_val.existence_confidence >= 0.6)
            notes.append(
                f"{verified_count}/{len(final_result.entities_verified)} entities appear verifiable (conf >= 0.6).")

        final_result.cross_ref_summary_notes = " | ".join(
            notes) if notes else "No items provided for cross-referencing."
        if final_result.cross_ref_module_error_message:
            final_result.cross_ref_summary_notes = "Errors occurred: " + final_result.cross_ref_module_error_message + " | " + final_result.cross_ref_summary_notes

        return final_result