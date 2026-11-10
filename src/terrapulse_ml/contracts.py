
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Optional, Any


class AnalysisMode(str, Enum):
    FLOOD = "flood"
    EARTHQUAKE = "earthquake"
    LANDSLIDE = "landslide"
    GLACIER = "glacier"
    WETLAND = "wetland"
    DEFORESTATION = "deforestation"
    AGRICULTURE = "agriculture"
    WILDFIRE_IMPACT = "wildfire_impact"


@dataclass
class AnalysisRequest:
    mode: AnalysisMode
    location: str
    before_date: date
    after_date: date

    def __post_init__(self):
        if not isinstance(self.mode, AnalysisMode):
            raise ValueError("Invalid analysis mode")
        if not self.location.strip():
            raise ValueError("Location cannot be empty")
        if self.before_date >= self.after_date:
            raise ValueError("Before date must be earlier")


@dataclass
class AnalysisResult:
    mode: AnalysisMode
    status: str
    change_map: Optional[str] = None
    magnitude: Optional[float] = None
    unit: Optional[str] = None
    confidence: Optional[float] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    def __post_init__(self):
        if self.status not in ("pending", "success", "failed"):
            raise ValueError("Invalid status")
        if self.confidence is not None:
            if not 0 <= self.confidence <= 1:
                raise ValueError("Confidence must be between 0 and 1")
