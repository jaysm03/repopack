#base.py
from abc import ABC, abstractmethod
from typing import Dict, List, Optional
from dataclasses import dataclass

@dataclass
class FileRelevance:
    path: str
    is_relevant: bool
    confidence: float
    reason: str

class AIProviderBase(ABC):
    @abstractmethod
    async def analyze_readme(self, content: str) -> Dict[str, any]:
        """Analyze README content and extract key information"""
        pass
    
    @abstractmethod
    async def evaluate_file_relevance(
        self, 
        file_path: str, 
        file_preview: str,
        project_context: Dict[str, any]
    ) -> FileRelevance:
        """Evaluate if a file is relevant for LLM context"""
        pass