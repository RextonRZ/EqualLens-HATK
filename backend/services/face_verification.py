import logging
import base64
from difflib import SequenceMatcher

from google.cloud import vision
from typing import Tuple, Dict, Any, List, Optional
import numpy as np
import re # For potential regex matching
import math
from services.gemini_service import GeminiService

try:
    import Levenshtein # Use the C implementation for speed
except ImportError:
    logging.error("The 'python-Levenshtein' library is required for name matching. Please install it using: pip install python-Levenshtein")
    raise ImportError("python-Levenshtein library not found.")

logger = logging.getLogger(__name__)

# Initialize the Google Cloud Vision client
try:
    vision_client = vision.ImageAnnotatorClient()
except Exception as e:
    logger.error(f"Failed to initialize Google Cloud Vision client: {e}. Ensure credentials are set up.")
    vision_client = None # Prevent usage if initialization fails


# Define key landmarks for geometric comparison (using Vision API Enum names)
ESSENTIAL_LANDMARK_TYPES = [
    vision.FaceAnnotation.Landmark.Type.LEFT_EYE,
    vision.FaceAnnotation.Landmark.Type.RIGHT_EYE,
    vision.FaceAnnotation.Landmark.Type.NOSE_TIP,
    vision.FaceAnnotation.Landmark.Type.MOUTH_LEFT,
    vision.FaceAnnotation.Landmark.Type.MOUTH_RIGHT,
    # Optional but good to have:
    vision.FaceAnnotation.Landmark.Type.LEFT_EYE_PUPIL,
    vision.FaceAnnotation.Landmark.Type.RIGHT_EYE_PUPIL,
    vision.FaceAnnotation.Landmark.Type.MOUTH_CENTER,
    vision.FaceAnnotation.Landmark.Type.CHIN_GNATHION,
    vision.FaceAnnotation.Landmark.Type.FOREHEAD_GLABELLA,
]

# Minimum number of essential landmarks required for comparison
MIN_REQUIRED_LANDMARKS = 5 # e.g., Both eyes, nose tip, mouth corners

# --- Helper Functions ---

def is_likely_name_part(text: str) -> bool:
    """Checks if a text block is likely part of a name (e.g., all caps, no digits, common length)."""
    text = text.strip()
    if not text:
        return False
    # Basic checks: Mostly letters, all caps are common on IDs, reasonable length
    return text.isalpha() and text.isupper() and 1 < len(text) < 20

def combine_adjacent_name_parts(text_blocks: List[vision.EntityAnnotation]) -> List[str]:
    """Combine adjacent blocks that look like name parts."""
    combined_names = []
    current_name_parts = []

    # Sort blocks roughly by position (top-to-bottom, left-to-right) - Vision API often returns in reading order
    # A more robust sorting might use bounding box coordinates if needed
    # sorted_blocks = sorted(text_blocks, key=lambda b: (b.bounding_poly.vertices[0].y, b.bounding_poly.vertices[0].x))
    # For simplicity, let's assume Vision API gives a reasonable order for nearby blocks

    for i, block in enumerate(text_blocks):
        text = block.description.strip()
        if is_likely_name_part(text):
            current_name_parts.append(text)
            # Check if the *next* block is also a likely name part and potentially adjacent
            # (Adjacency check can be complex, let's rely on sequence for now)
            is_last_block = (i == len(text_blocks) - 1)
            next_block_is_name = not is_last_block and is_likely_name_part(text_blocks[i+1].description.strip())

            # If this is the last name part in a sequence, combine them
            if not next_block_is_name or is_last_block:
                if current_name_parts:
                    combined_names.append(" ".join(current_name_parts))
                    current_name_parts = [] # Reset for next potential name
        else:
            # If the current block is not a name part, finalize any pending name
            if current_name_parts:
                combined_names.append(" ".join(current_name_parts))
                current_name_parts = []

    # Add any remaining parts if the last block was a name part
    if current_name_parts:
        combined_names.append(" ".join(current_name_parts))

    return combined_names

def calculate_distance(p1: Dict[str, float], p2: Dict[str, float]) -> float:
    """Calculate Euclidean distance between two 2D points represented as dictionaries."""
    # This function expects dictionaries like {'x': value, 'y': value}
    return math.sqrt((p1['x'] - p2['x'])**2 + (p1['y'] - p2['y'])**2)

def get_landmark_position(landmarks: List[Dict[str, Any]], landmark_type: vision.FaceAnnotation.Landmark.Type) -> Dict[str, float] | None:
    """Find the position of a specific landmark type."""
    for lm in landmarks:
        if lm['type_enum'] == landmark_type:
            return lm['position']
    return None

def normalize_landmarks(landmarks: List[Dict[str, Any]]) -> Tuple[Dict[vision.FaceAnnotation.Landmark.Type, Dict[str, float]], float] | Tuple[None, None]:
    """
    Normalize landmark positions relative to eye distance and center.
    Returns a dictionary mapping landmark enum to normalized positions, and the inter-eye distance,
    or (None, None) if eyes not found.
    """
    left_eye = get_landmark_position(landmarks, vision.FaceAnnotation.Landmark.Type.LEFT_EYE)
    right_eye = get_landmark_position(landmarks, vision.FaceAnnotation.Landmark.Type.RIGHT_EYE)

    if not left_eye or not right_eye:
        logger.warning("Could not find both eye landmarks for normalization.")
        return None, None

    inter_eye_distance = calculate_distance(left_eye, right_eye)
    if inter_eye_distance < 1e-6: # Avoid division by zero
        logger.warning("Inter-eye distance is too small for normalization.")
        return None, None

    eye_center_x = (left_eye['x'] + right_eye['x']) / 2
    eye_center_y = (left_eye['y'] + right_eye['y']) / 2

    normalized = {}
    for lm in landmarks:
        pos = lm['position']
        norm_x = (pos['x'] - eye_center_x) / inter_eye_distance
        norm_y = (pos['y'] - eye_center_y) / inter_eye_distance
        # Keep z for potential future 3D comparisons, but normalize based on 2D eye distance
        normalized[lm['type_enum']] = {'x': norm_x, 'y': norm_y, 'z': pos['z']} # Map enum to position dict

    return normalized, inter_eye_distance


# --- Core Functions ---

def detect_faces(image_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Detect faces in an image using Google Cloud Vision API, extracting detailed landmark info.

    Args:
        image_bytes: Raw image bytes

    Returns:
        List of detected face features including semantic landmark types.
    """
    if not vision_client:
         logger.error("Vision client not initialized. Cannot detect faces.")
         return []
    try:
        image = vision.Image(content=image_bytes)
        response = vision_client.face_detection(image=image)
        faces = response.face_annotations

        if response.error.message:
             logger.error(f"Vision API error: {response.error.message}")
             # Consider raising an exception or returning specific error info
             return []

        if not faces:
            logger.info("No faces detected in the image") # Use info level for no faces
            return []

        face_data = []
        for face in faces:
            landmarks_list = []
            for landmark in face.landmarks:
                landmarks_list.append({
                    "type_name": landmark.type_.name,
                    "type_enum": landmark.type_,
                    "position": {
                        "x": landmark.position.x,
                        "y": landmark.position.y,
                        "z": landmark.position.z
                    }
                })

            # Store bounding poly vertices as simple dicts for easier processing later
            bounding_poly_vertices = [{"x": vertex.x, "y": vertex.y} for vertex in face.bounding_poly.vertices]

            face_info = {
                "bounding_poly": bounding_poly_vertices, # Store the list of dicts
                "landmarks": landmarks_list,
                "detection_confidence": face.detection_confidence,
                "roll_angle": face.roll_angle,
                "pan_angle": face.pan_angle,
                "tilt_angle": face.tilt_angle,
                "joy_likelihood": face.joy_likelihood.name,
                "sorrow_likelihood": face.sorrow_likelihood.name,
                "anger_likelihood": face.anger_likelihood.name,
                "surprise_likelihood": face.surprise_likelihood.name,
                "under_exposed_likelihood": face.under_exposed_likelihood.name,
                "blurred_likelihood": face.blurred_likelihood.name,
                "headwear_likelihood": face.headwear_likelihood.name,
                # Initialize area/width/height
                "area": 0.0,
                "width": 0.0,
                "height": 0.0
            }

            # Calculate area and dimensions if bounding poly is valid
            vertices = face.bounding_poly.vertices # Get the original Vertex objects for calculation
            if len(vertices) == 4:
                 try:
                    # Using Shoelace formula for polygon area
                    area = 0.5 * abs(vertices[0].x * vertices[1].y + vertices[1].x * vertices[2].y + vertices[2].x * vertices[3].y + vertices[3].x * vertices[0].y - \
                                    (vertices[1].x * vertices[0].y + vertices[2].x * vertices[1].y + vertices[3].x * vertices[2].y + vertices[0].x * vertices[3].y))
                    face_info["area"] = area

                    # ***** FIX HERE *****
                    # Convert Vertex objects to dictionaries before passing to calculate_distance
                    v0_dict = {'x': vertices[0].x, 'y': vertices[0].y}
                    v1_dict = {'x': vertices[1].x, 'y': vertices[1].y}
                    # v2_dict = {'x': vertices[2].x, 'y': vertices[2].y} # Not needed for width/height approx
                    v3_dict = {'x': vertices[3].x, 'y': vertices[3].y}

                    # Approx width (distance between vertex 0 and 1)
                    width = calculate_distance(v0_dict, v1_dict)
                    # Approx height (distance between vertex 0 and 3)
                    height = calculate_distance(v0_dict, v3_dict)

                    face_info["width"] = width
                    face_info["height"] = height
                 except AttributeError as e:
                     logger.warning(f"Could not calculate area/dimensions for a face, missing attributes? Error: {e}")
                 except Exception as e: # Catch other potential errors during calculation
                     logger.warning(f"Error calculating face area/dimensions: {e}")
            else:
                 logger.warning(f"Detected face bounding polygon does not have 4 vertices ({len(vertices)} found). Cannot calculate area/dimensions accurately.")

            face_data.append(face_info)

        return face_data

    except Exception as e:
        # Log the full traceback for unexpected errors
        logger.error(f"Error detecting faces: {str(e)}", exc_info=True)
        return []


def compare_face_features(live_face: Dict[str, Any], id_face: Dict[str, Any]) -> Tuple[bool, float, Dict[str, Any]]:
    """
    Compare facial features using normalized geometric landmark positions.

    Args:
        live_face: Face data assumed to be from the live person.
        id_face: Face data assumed to be from the ID card.

    Returns:
        Tuple of (match_result, confidence_score, debug_info)
    """
    debug_info = {
        "live_detection_confidence": live_face.get('detection_confidence', 0),
        "id_detection_confidence": id_face.get('detection_confidence', 0),
        "live_landmarks_count": len(live_face.get('landmarks', [])),
        "id_landmarks_count": len(id_face.get('landmarks', [])),
        "required_landmarks": MIN_REQUIRED_LANDMARKS,
        "geometric_comparison": {}
    }

    # --- Initial Checks ---
    if not live_face or not id_face:
         debug_info["error"] = "Missing live or ID face data."
         return False, 0.0, debug_info

    live_landmarks = live_face.get('landmarks', [])
    id_landmarks = id_face.get('landmarks', [])

    if not live_landmarks or not id_landmarks:
        debug_info["error"] = "Landmarks missing from one or both faces."
        return False, 0.0, debug_info

    # --- Normalization ---
    norm_live_landmarks, live_eye_dist = normalize_landmarks(live_landmarks)
    norm_id_landmarks, id_eye_dist = normalize_landmarks(id_landmarks)

    if not norm_live_landmarks or not norm_id_landmarks:
        debug_info["error"] = "Normalization failed (likely missing eye landmarks)."
        base_confidence = math.sqrt(live_face.get('detection_confidence', 0) * id_face.get('detection_confidence', 0))
        return False, base_confidence * 0.3, debug_info # Low confidence if geometry fails

    debug_info["live_inter_eye_distance"] = live_eye_dist
    debug_info["id_inter_eye_distance"] = id_eye_dist

    # --- Geometric Comparison ---
    comparison_results = []
    total_distance = 0.0
    landmarks_compared = 0

    common_landmark_types = set(norm_live_landmarks.keys()) & set(norm_id_landmarks.keys())
    target_comparison_types = [lm_type for lm_type in ESSENTIAL_LANDMARK_TYPES if lm_type in common_landmark_types]

    debug_info["geometric_comparison"]["common_essential_landmarks"] = [lm.name for lm in target_comparison_types]

    if len(target_comparison_types) < MIN_REQUIRED_LANDMARKS:
        debug_info["error"] = f"Insufficient common essential landmarks found ({len(target_comparison_types)}/{MIN_REQUIRED_LANDMARKS}). Cannot perform reliable geometric comparison."
        base_confidence = math.sqrt(live_face.get('detection_confidence', 0) * id_face.get('detection_confidence', 0))
        return False, base_confidence * 0.4, debug_info # Slightly higher confidence than normalization failure

    for lm_type in target_comparison_types:
        if lm_type == vision.FaceAnnotation.Landmark.Type.LEFT_EYE or lm_type == vision.FaceAnnotation.Landmark.Type.RIGHT_EYE:
            continue # Skip eyes used for normalization

        live_lm_norm = norm_live_landmarks.get(lm_type)
        id_lm_norm = norm_id_landmarks.get(lm_type)

        # Check if landmark exists in both normalized sets (should always be true here due to common_landmark_types logic, but safe check)
        if live_lm_norm and id_lm_norm:
            try:
                distance = calculate_distance(live_lm_norm, id_lm_norm)
                total_distance += distance
                landmarks_compared += 1
                comparison_results.append({
                    "type": lm_type.name,
                    "normalized_live_pos": {"x": live_lm_norm['x'], "y": live_lm_norm['y']},
                    "normalized_id_pos": {"x": id_lm_norm['x'], "y": id_lm_norm['y']},
                    "normalized_distance": distance
                })
            except KeyError as e:
                 logger.warning(f"KeyError accessing normalized landmark positions for {lm_type.name}: {e}. Skipping this landmark.")
                 debug_info["geometric_comparison"].setdefault("skipped_landmarks", []).append(lm_type.name)
            except Exception as e:
                 logger.error(f"Unexpected error comparing landmark {lm_type.name}: {e}", exc_info=True)
                 debug_info["geometric_comparison"].setdefault("comparison_errors", []).append(lm_type.name)


    debug_info["geometric_comparison"]["details"] = comparison_results
    debug_info["geometric_comparison"]["landmarks_used_in_score"] = landmarks_compared

    if landmarks_compared < max(1, MIN_REQUIRED_LANDMARKS - 2): # Require at least a few non-eye landmarks
         debug_info["error"] = f"Insufficient non-eye landmarks available or comparable for geometric score ({landmarks_compared})."
         base_confidence = math.sqrt(live_face.get('detection_confidence', 0) * id_face.get('detection_confidence', 0))
         return False, base_confidence * 0.4, debug_info

    # --- Calculate Geometric Similarity Score ---
    average_distance = total_distance / landmarks_compared
    # Adjust the scaling factor (e.g., 5.0) based on typical distances observed during testing.
    # This factor significantly impacts sensitivity. Higher values make it more sensitive to small distances.
    GEOMETRIC_DISTANCE_SENSITIVITY = 5.0
    geometric_similarity = math.exp(-GEOMETRIC_DISTANCE_SENSITIVITY * average_distance)

    debug_info["geometric_comparison"]["average_normalized_distance"] = average_distance
    debug_info["geometric_comparison"]["geometric_similarity_score"] = geometric_similarity

    # --- Final Confidence Calculation ---
    detection_confidence_factor = math.sqrt(live_face.get('detection_confidence', 0) * id_face.get('detection_confidence', 0))
    # Weight geometric similarity higher (e.g., 70%)
    final_confidence = (geometric_similarity * 0.7) + (detection_confidence_factor * 0.3)
    final_confidence = max(0.0, min(1.0, final_confidence)) # Clamp between 0 and 1

    debug_info["detection_confidence_factor"] = detection_confidence_factor
    debug_info["final_confidence"] = final_confidence

    # --- Decision ---
    match_threshold = 0.70  # Tune this threshold based on test data
    match_result = final_confidence > match_threshold

    debug_info["match_threshold"] = match_threshold
    debug_info["match_result"] = match_result

    return match_result, final_confidence, debug_info

def find_text_near_face(text_annotations: List[vision.EntityAnnotation], face_bounding_poly: List[Dict[str, int]], max_distance_factor=1.5) -> List[vision.EntityAnnotation]:
    """Find text blocks reasonably close to the ID face bounding box."""
    nearby_texts = []
    if not face_bounding_poly or len(face_bounding_poly) != 4:
         logger.warning("Invalid face bounding poly provided for text search.")
         return []

    # Calculate center of the face bounding box
    face_center_x = sum(v['x'] for v in face_bounding_poly) / 4
    face_center_y = sum(v['y'] for v in face_bounding_poly) / 4
    # Estimate diagonal as a measure of face size
    face_width = abs(face_bounding_poly[0]['x'] - face_bounding_poly[1]['x']) # Approx
    face_height = abs(face_bounding_poly[0]['y'] - face_bounding_poly[3]['y']) # Approx
    face_diagonal = math.sqrt(face_width**2 + face_height**2)
    max_distance = face_diagonal * max_distance_factor

    # Skip the first annotation (full text)
    for annotation in text_annotations[1:]:
        if not annotation.bounding_poly or not annotation.bounding_poly.vertices:
            continue

        # Calculate center of the text block
        text_vertices = annotation.bounding_poly.vertices
        text_center_x = sum(v.x for v in text_vertices) / len(text_vertices)
        text_center_y = sum(v.y for v in text_vertices) / len(text_vertices)

        distance = math.sqrt((face_center_x - text_center_x)**2 + (face_center_y - text_center_y)**2)

        if distance < max_distance:
            nearby_texts.append(annotation)

    return nearby_texts

def group_blocks_by_line(text_blocks: List[vision.EntityAnnotation], y_tolerance=5) -> List[List[vision.EntityAnnotation]]:
    """Groups text blocks that are vertically close (likely on the same line)."""
    if not text_blocks:
        return []

    # Sort primarily by top Y coordinate, then by left X coordinate
    blocks = sorted(text_blocks, key=lambda b: (
        b.bounding_poly.vertices[0].y if b.bounding_poly and b.bounding_poly.vertices else 0,
        b.bounding_poly.vertices[0].x if b.bounding_poly and b.bounding_poly.vertices else 0
    ))

    lines = []
    current_line = []
    if not blocks: return lines

    current_line.append(blocks[0])
    last_y = blocks[0].bounding_poly.vertices[0].y if blocks[0].bounding_poly and blocks[0].bounding_poly.vertices else 0

    for i in range(1, len(blocks)):
        block = blocks[i]
        current_y = block.bounding_poly.vertices[0].y if block.bounding_poly and block.bounding_poly.vertices else 0
        # Check if the block's top is close to the last block's top Y
        if abs(current_y - last_y) <= y_tolerance:
            current_line.append(block)
        else:
            # New line started
            if current_line:
                # Sort blocks within the line by X coordinate before adding
                lines.append(sorted(current_line, key=lambda b: b.bounding_poly.vertices[0].x if b.bounding_poly and b.bounding_poly.vertices else 0))
            current_line = [block]
            last_y = current_y

    # Add the last line
    if current_line:
         lines.append(sorted(current_line, key=lambda b: b.bounding_poly.vertices[0].x if b.bounding_poly and b.bounding_poly.vertices else 0))

    return lines

def extract_name_rule_based(text_blocks: List[vision.EntityAnnotation], candidate_name_hint: Optional[str] = None) -> Optional[str]:
    """
    (Formerly extract_name_from_text)
    Attempt to extract a name from text blocks found near the ID using rule-based heuristics.
    """
    potential_names = []
    name_keywords = ["name", "nama", "given name", "surname", "family name"]
    stop_keywords = [
        "card", "no.", "ic", "number", "passport", "nationality", "sex", "date", "birth", "address", "alamat",
        "valid", "issue", "expiry", "lesen", "memandu", "driving", "license", "class", "kelas",
        "malaysia", "johor", "bahru", "sungai", "danga", "universiti", "malaya", "myrapid",
        "government", "kerajaan",
    ]

    lines = group_blocks_by_line(text_blocks)
    logger.debug(f"[RuleBased] Grouped lines: {[[b.description for b in line] for line in lines]}")

    keyword_based_names = set()
    processed_line_indices = set()

    for i, line in enumerate(lines):
        line_text_lower = " ".join(b.description for b in line).lower()
        found_keyword = False
        for keyword in name_keywords:
            if keyword in line_text_lower:
                found_keyword = True
                processed_line_indices.add(i)
                keyword_pos = line_text_lower.find(keyword)
                accumulated_text_after_keyword = ""
                for block in line:
                    block_text_lower = block.description.lower()
                    block_start_in_line = line_text_lower.find(block_text_lower)
                    if block_start_in_line >= keyword_pos + len(keyword):
                         accumulated_text_after_keyword += block.description + " "
                name_candidate = accumulated_text_after_keyword.strip().strip(':').strip()
                if (not name_candidate or len(name_candidate) < 3) and i + 1 < len(lines):
                     next_line_text = " ".join(b.description for b in lines[i+1]).strip()
                     if next_line_text and len(next_line_text) > 2:
                          if not name_candidate:
                               name_candidate = next_line_text
                               processed_line_indices.add(i+1)
                if name_candidate:
                    cleaned_name = re.sub(r'\d+', '', name_candidate).strip()
                    final_parts = [part for part in cleaned_name.split() if part.lower() not in stop_keywords]
                    final_name = " ".join(final_parts).upper()
                    if final_name and len(final_name) > 2:
                        keyword_based_names.add(final_name)
                break
    logger.info(f"[RuleBased] Keyword-based name candidates: {keyword_based_names}")
    potential_names.extend(list(keyword_based_names))

    for i, line in enumerate(lines):
        if i in processed_line_indices: continue
        line_parts = [b.description.strip() for b in line]
        consecutive_name_parts = []
        possible_line_names = []
        for part in line_parts:
            if part.isalpha() and part.isupper() and len(part) > 0:
                 consecutive_name_parts.append(part)
            else:
                 if 1 < len(consecutive_name_parts) <= 4:
                      possible_line_names.append(" ".join(consecutive_name_parts))
                 consecutive_name_parts = []
        if 1 < len(consecutive_name_parts) <= 4:
             possible_line_names.append(" ".join(consecutive_name_parts))
        for pname in possible_line_names:
             if not any(stop in pname.lower() for stop in stop_keywords):
                  if pname not in potential_names:
                       potential_names.append(pname)

    logger.info(f"[RuleBased] Pattern-based name candidates: {potential_names}")

    if not potential_names:
        logger.warning("[RuleBased] No potential names found.")
        return None

    seen = set()
    unique_potential_names = [x for x in potential_names if not (x in seen or seen.add(x))]
    logger.info(f"[RuleBased] Unique potential names for matching: {unique_potential_names}")

    if candidate_name_hint:
        best_match = None
        highest_score = 0.70
        normalized_hint = " ".join(candidate_name_hint.upper().split())
        for name in unique_potential_names:
            normalized_name = " ".join(name.split())
            try:
                score = Levenshtein.ratio(normalized_hint, normalized_name)
                hint_contained_score = 0.0
                if normalized_name.startswith(normalized_hint) or normalized_name.endswith(normalized_hint) or (" " + normalized_hint + " ") in (" " + normalized_name + " "):
                    hint_contained_score = 0.95
                effective_score = max(score, hint_contained_score)
                logger.debug(f"[RuleBased] Comparing '{normalized_hint}' vs '{normalized_name}', Levenshtein: {score:.2f}, Contained: {hint_contained_score > 0}, Effective: {effective_score:.2f}")
            except Exception as e:
                 logger.warning(f"[RuleBased] Levenshtein/Comparison error between '{normalized_hint}' and '{normalized_name}': {e}")
                 effective_score = 0.0
            if effective_score > highest_score:
                highest_score = effective_score
                best_match = name
        if best_match: logger.info(f"[RuleBased] Name matching: Hint='{normalized_hint}', Best Match='{best_match}' with score {highest_score:.2f}")
        else: logger.warning(f"[RuleBased] Name matching: Hint='{normalized_hint}', No match found above threshold {highest_score} among {unique_potential_names}")
        return best_match
    else:
        sorted_candidates = sorted(unique_potential_names, key=lambda n: (len(n.split()), len(n)))
        for name in sorted_candidates:
             if 1 < len(name.split()) <= 3:
                  logger.info(f"[RuleBased] Name extraction (no hint): Selected preferred candidate='{name}' from {unique_potential_names}")
                  return name
        selected_name = unique_potential_names[0] if unique_potential_names else None
        logger.info(f"[RuleBased] Name extraction (no hint): Selected fallback candidate='{selected_name}' from {unique_potential_names}")
        return selected_name

def fuzzy_compare_names(name1: str, name2: str, threshold=0.75) -> Tuple[bool, float]:
    """Compare two names using fuzzy matching (SequenceMatcher)."""
    if not name1 or not name2:
        return False, 0.0
    # Normalize: uppercase, remove extra spaces
    n1 = " ".join(name1.upper().split())
    n2 = " ".join(name2.upper().split())
    try:
        score = Levenshtein.ratio(n1, n2)
    except Exception as e:
        # Handle potential errors from Levenshtein if inputs are weird
        logger.warning(f"Levenshtein ratio calculation error between '{n1}' and '{n2}': {e}")
        score = 0.0
    return score >= threshold, score

# --- Gemini-Based Extraction Function ---
async def extract_name_with_gemini(text_blocks: List[vision.EntityAnnotation], candidate_name_hint: Optional[str] = None) -> Optional[str]:
    """
    Uses Gemini to identify the candidate's name from text blocks found near the ID.

    Args:
        text_blocks: List of EntityAnnotation objects from Vision API text detection (nearby blocks).
        candidate_name_hint: The candidate's name from the database (optional).

    Returns:
        The extracted name string, or None if not found or on error.
    """
    if not text_blocks:
        return None

    # Combine descriptions from nearby blocks
    full_text = "\n".join([block.description for block in text_blocks])

    # Prepare the prompt for Gemini
    prompt = f"""
    Analyze the following text extracted from an ID card, found near the person's photo.
    Your goal is to identify and extract the **full name** of the person.

    Extracted Text Blocks (each line might be a separate block):
    --- START TEXT ---
    {full_text}
    --- END TEXT ---

    Candidate Name Hint (from database, if available): "{candidate_name_hint if candidate_name_hint else 'Not Provided'}"

    Instructions:
    1. Carefully read the text blocks.
    2. Identify the line(s) or block(s) most likely containing the person's full name. Consider common ID layouts (e.g., name often near the top or after a "Name:" label).
    3. If the `Candidate Name Hint` is provided, prioritize extracting the text that most closely matches the hint.
    4. Combine adjacent text blocks if they clearly form parts of the name (e.g., "LIM" followed by "AH KOW").
    5. Exclude labels (like "Name:", "Nama:"), numbers, dates, addresses, nationality, and other non-name fields.
    6. Return ONLY the extracted full name as a single string.
    7. If no plausible name is found, return the exact string "NONE".

    Example Input Text:
    MYKAD
    880808-08-8888
    LIM AH KOW
    NO 1 JALAN...
    MALAYSIA

    Example Output (if hint was "LIM AH KOW"): LIM AH KOW

    Example Input Text:
    PASSPORT
    A12345678
    SURNAME: DOE
    GIVEN NAMES: JOHN MICHAEL
    NATIONALITY: ...

    Example Output (if hint was "JOHN MICHAEL DOE"): JOHN MICHAEL DOE

    Example Output (if hint was "JANE SMITH" but text showed "MARY JONES"): MARY JONES

    Example Output (if no name found): NONE
    """

    try:
        gemini_service = GeminiService() # Assumes GeminiService is set up
        async with gemini_service.semaphore:
            response = await gemini_service.model.generate_content_async(prompt)
            extracted_name = response.text.strip()

        logger.info(f"[Gemini] Extraction attempt result: '{extracted_name}'")

        # Post-process Gemini's response
        if not extracted_name or extracted_name.upper() == "NONE" or len(extracted_name) < 3:
             logger.warning("[Gemini] No plausible name extracted.")
             return None
        else:
             # Basic cleanup: remove potential quotes, extra whitespace
             cleaned_name = extracted_name.strip('\'"')
             # Further cleanup might be needed depending on Gemini's typical output quirks
             logger.info(f"[Gemini] Extracted and cleaned name: '{cleaned_name}'")
             return cleaned_name.upper() # Return consistent uppercase

    except Exception as e:
        logger.error(f"[Gemini] Error during name extraction: {str(e)}", exc_info=True)
        return None

async def process_verification_image_with_name_check(image_bytes: bytes, db_candidate_name: Optional[str]) -> Dict[str, Any]:
    """
    Process the verification image to verify identity with enhanced security.
    Args:
        image_bytes: Raw image bytes. # Corrected comment
        db_candidate_name: Candidate's name from the database for comparison. # Added comment
    Returns:
        Dictionary with verification results.
    """
    # try: # Keep the main try block
    if not vision_client:
        return {"verified": False, "face_verified": False, "name_verified": False, "confidence": 0.0,
                "message": "Vision API client not initialized.",
                "debug_info": {"error": "Vision client unavailable"}}

    final_result = {
        "verified": False, # Initialize overall verification status
        "face_verified": False,
        "name_verified": False,
        "face_confidence": 0.0,
        "extracted_name": None,
        "name_match_score": 0.0,
        "message": "Verification pending.",
        "debug_info": {}
    }

    try: # Add internal try/except for robustness during processing

        # --- 1. Face Detection ---
        all_faces = detect_faces(image_bytes)
        final_result["debug_info"]["face_detection"] = {"total_faces_detected": len(all_faces)}
        # Assign debug_info directly to final_result for consistency
        # debug_info = {"total_faces_detected": len(all_faces)} # Remove redundant variable

        if len(all_faces) != 2:
            # ... (keep face count error handling) ...
            if not all_faces:
                 final_result["message"] = "No faces detected. Ensure the image is clear and shows both your face and ID."
            elif len(all_faces) == 1:
                 final_result["message"] = "Only one face detected. Ensure both your face and the face on the ID card are clearly visible."
            else:
                 final_result["message"] = f"Detected {len(all_faces)} faces. Please provide an image with exactly one person and their ID card."
            return final_result # Return early

        # --- 2. Face Assignment (Live vs. ID) ---
        # ... (keep sorting and assignment logic) ...
        valid_faces = [f for f in all_faces if f.get("area", 0) > 1e-6]
        faces_to_sort = valid_faces if len(valid_faces) == 2 else all_faces
        sorted_faces = sorted(faces_to_sort, key=lambda x: (x.get("area", 0), x.get("detection_confidence", 0)), reverse=True)
        live_face, id_face = sorted_faces[0], sorted_faces[1]
        id_face_poly = id_face.get("bounding_poly")
        final_result["debug_info"]["face_assignment"] = { # Add assignment details to debug info
             "live_face_area": live_face.get("area"),
             "id_face_area": id_face.get("area"),
             "note": "Assigned based on sorting order (likely largest area first)." # Simplified note
        }


        # --- 3. Face Comparison ---
        match_result, confidence, comparison_debug = compare_face_features(live_face, id_face)
        final_result["face_verified"] = match_result
        final_result["face_confidence"] = confidence
        final_result["debug_info"]["face_comparison"] = comparison_debug
        # Don't set final message here yet


        # --- 4. Text Detection ---
        image = vision.Image(content=image_bytes)
        text_response = vision_client.text_detection(image=image)
        text_annotations = text_response.text_annotations
        final_result["debug_info"]["text_detection"] = {"total_blocks": len(text_annotations)}
        extracted_name = None # Initialize here
        if text_response.error.message:
            logger.error(f"Vision API Text Detection error: {text_response.error.message}")
            final_result["debug_info"]["text_detection"]["error"] = text_response.error.message
        elif text_annotations and id_face_poly:
            nearby_text_blocks = find_text_near_face(text_annotations, id_face_poly)
            final_result["debug_info"]["text_detection"]["nearby_blocks_count"] = len(nearby_text_blocks)
            final_result["debug_info"]["text_detection"]["nearby_texts"] = [block.description for block in nearby_text_blocks]

        # --- 5. Name Extraction (Rule-Based + Gemini Fallback/Alternative) ---
        extracted_name = None
        extraction_method = "None"  # Track which method succeeded

        if nearby_text_blocks:
            # Try rule-based first
            rule_based_name = extract_name_rule_based(nearby_text_blocks, db_candidate_name)
            final_result["debug_info"]["name_extraction_rule_based"] = {"extracted": rule_based_name}
            if rule_based_name:
                extracted_name = rule_based_name
                extraction_method = "Rule-Based"
                logger.info(f"Name extracted using Rule-Based method: '{extracted_name}'")

            # If rule-based failed OR you want Gemini to always try:
            # Condition: Use Gemini if rule-based failed OR (always_use_gemini_flag is True)
            # For now, let's use Gemini as a fallback if rule-based fails
            if not extracted_name:
                logger.info("Rule-based name extraction failed or returned None. Trying Gemini.")
                gemini_name = await extract_name_with_gemini(nearby_text_blocks, db_candidate_name)
                final_result["debug_info"]["name_extraction_gemini"] = {"extracted": gemini_name}
                if gemini_name:
                    extracted_name = gemini_name  # Use Gemini's result
                    extraction_method = "Gemini"
                    logger.info(f"Name extracted using Gemini method: '{extracted_name}'")
                else:
                    logger.warning("Both Rule-Based and Gemini name extraction failed.")
            else:
                # Optionally, you could still call Gemini here to see if it offers a *better* match
                # to the hint than the rule-based one, but that adds complexity/cost.
                pass

        final_result["extracted_name"] = extracted_name  # Store the final extracted name
        final_result["debug_info"]["name_extraction"] = {
            "final_extracted": extracted_name,
            "method_used": extraction_method
        }

        # --- 6. Name Comparison (using the final extracted_name) ---
        if extracted_name and db_candidate_name:
            name_match, name_score = fuzzy_compare_names(extracted_name, db_candidate_name)
            final_result["name_verified"] = name_match
            final_result["name_match_score"] = name_score
            final_result["debug_info"]["name_comparison"] = {"db_name": db_candidate_name,
                                                             "extracted_name": extracted_name, "score": name_score,
                                                             "match": name_match}
        elif not db_candidate_name:
            final_result["name_verified"] = True  # Cannot verify, so pass
            final_result["debug_info"]["name_comparison"] = {"status": "Skipped - No DB name"}
        else:  # Name extraction failed OR db_name exists but extracted_name is None
            final_result["name_verified"] = False
            final_result["name_match_score"] = 0.0
            final_result["debug_info"]["name_comparison"] = {
                "status": "Failed - Extraction failed OR Extracted name is null"}
            if not extracted_name:
                final_result["debug_info"]["name_comparison"][
                    "reason"] = "Could not read name from ID card (Rule-Based & Gemini failed)"

        # --- 7. Final Decision and Message (keep existing) ---
        final_result["verified"] = final_result["face_verified"] and final_result["name_verified"]
        if final_result["verified"]:
            final_result["message"] = "Identity verification successful (Face and Name matched)."
        else:
            reasons = []
            if not final_result["face_verified"]: reasons.append(
                f"Face comparison failed (Confidence: {final_result.get('face_confidence', 0.0):.2f})")
            if not final_result["name_verified"]:
                if not extracted_name and db_candidate_name:
                    reasons.append("Could not read name from ID card")
                elif extracted_name and db_candidate_name:
                    reasons.append(
                        f"Name mismatch (Extracted: '{extracted_name}', DB: '{db_candidate_name}', Score: {final_result.get('name_match_score', 0.0):.2f})")
            if not reasons and not final_result["verified"]: reasons.append("Unknown verification issue")
            final_result["message"] = f"Identity verification failed: {'; '.join(reasons)}."

        return final_result
    except Exception as e:
        logger.error(f"Critical error during verification image processing: {str(e)}", exc_info=True)
        # Ensure final_result reflects the error state accurately
        final_result["verified"] = False
        final_result["face_verified"] = False # Reset flags on critical error
        final_result["name_verified"] = False
        final_result["message"] = "An unexpected server error occurred during identity verification."
        final_result["debug_info"]["critical_error"] = f"{type(e).__name__}: {str(e)}"
        return final_result

