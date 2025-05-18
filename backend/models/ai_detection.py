from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

class AIDetectionResult(BaseModel):
    filename: str
    is_ai_generated: bool
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: Optional[str] = None
    details: Optional[Dict[str, Any]] = None