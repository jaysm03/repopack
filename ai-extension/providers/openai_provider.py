#openai_provider.py
from typing import Dict, List, Optional
from pydantic import BaseModel
from openai import AsyncClient
from .base import AIProviderBase, FileRelevance
import logging
from pathlib import Path
import time
import json

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("OpenAIProvider")

class CodeContext(BaseModel):
    file_type: str
    purpose: str
    relevance_score: float
    key_components: List[str]
    dependencies: List[str]

class ReadmeAnalysis(BaseModel):
    project_purpose: str
    core_features: List[str]
    key_components: List[str]
    important_patterns: List[str]
    dependencies: List[str]

class FileAnalysis(BaseModel):
    is_relevant: bool
    confidence: float
    reason: str

README_SCHEMA = {
    "type": "object",
    "properties": {
        "project_purpose": {"type": "string"},
        "core_features": {"type": "array", "items": {"type": "string"}},
        "key_components": {"type": "array", "items": {"type": "string"}},
        "important_patterns": {"type": "array", "items": {"type": "string"}},
        "dependencies": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["project_purpose", "core_features", "key_components", 
                "important_patterns", "dependencies"],
    "additionalProperties": False
}

FILE_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "is_relevant": {"type": "boolean"},
        "confidence": {"type": "number"},
        "reason": {"type": "string"}
    },
    "required": ["is_relevant", "confidence", "reason"],
    "additionalProperties": False
}

def is_known_text_file(file_path: str) -> bool:
    """Check if the file has a known text file extension."""
    text_extensions = {
        '.py', '.txt', '.md', '.rst', '.ini', '.cfg', '.yml', '.yaml', 
        '.json', '.toml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx',
        '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1',
        '.sql', '.env', '.gitignore', '.dockerignore', 'Dockerfile',
        '.conf', '.config', '.xml', '.csv', '.template', '.j2',
        'README', 'LICENSE', 'Makefile', '.php', '.rb', '.pl', '.java',
        '.cpp', '.hpp', '.c', '.h', '.go', '.rs', '.swift'
    }
    
    # Handle files without extensions (like 'README' or 'Makefile')
    if Path(file_path).name in {'README', 'Makefile', 'Dockerfile', 'LICENSE'}:
        return True
        
    return Path(file_path).suffix.lower() in text_extensions

def is_definitely_binary(file_path: str) -> bool:
    """Check if the file has a known binary extension."""
    binary_extensions = {
        '.pyc', '.pyo', '.pyd', '.so', '.dll', '.dylib', '.exe',
        '.bin', '.pkl', '.db', '.sqlite', '.sqlite3', '.mdb',
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg',
        '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
        '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
        '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
        '.ttf', '.otf', '.woff', '.woff2', '.eot',
        '.o', '.a', '.lib', '.pak', '.class'
    }
    return Path(file_path).suffix.lower() in binary_extensions

def is_binary_content(content: str) -> bool:
    """Check if the content appears to be binary."""
    try:
        # Try to encode as ASCII to check for binary content
        content.encode('ascii')
        return False
    except UnicodeEncodeError:
        # If it contains non-ASCII characters, check if it's still readable text
        try:
            content.encode('utf-8')
            return False
        except UnicodeEncodeError:
            return True

def read_file_safely(file_path: str, max_lines: int = 50) -> Optional[str]:
    """Safely read a file, returning None if it's binary or unreadable."""
    try:
        # First check extensions
        if is_definitely_binary(file_path):
            logger.debug(f"Skipping known binary file: {file_path}")
            return None
            
        if is_known_text_file(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                return "".join(f.readlines()[:max_lines])

        # For unknown extensions, try to read and check content
        with open(file_path, 'r', encoding='utf-8') as f:
            content = "".join(f.readlines()[:max_lines])
            if is_binary_content(content):
                return None
            return content
            
    except (UnicodeDecodeError, OSError):
        logger.debug(f"Could not read file as text: {file_path}")
        return None

class OpenAIProvider(AIProviderBase):
    def __init__(self, api_key: str):
        logger.info("Initializing OpenAI provider with AsyncClient")
        self.client = AsyncClient(api_key=api_key)
        self.files_processed = 0
        self.binary_files_skipped = 0
        self.errors_encountered = 0
        
    async def analyze_readme(self, content: str) -> Dict[str, any]:
        """Analyze README content using OpenAI's structured output."""
        try:
            logger.info("Starting README analysis...")
            logger.info(f"README content length: {len(content)} characters")
            start_time = time.time()

            prompt = f"""Analyze the provided README content and output a JSON object with the following structure:
            {README_SCHEMA}
            
            Remember:
            - All fields are required
            - No additional properties are allowed
            - Arrays must contain strings
            
            README Content:
            {content}"""

            logger.info("Making API call to analyze README...")
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are an expert code analyst. Analyze the README content to understand the project structure. Output must be valid JSON matching the specified schema."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            api_time = time.time() - start_time
            logger.info(f"Received README analysis response (took {api_time:.2f}s)")
            
            # Parse the response into our Pydantic model
            analysis = ReadmeAnalysis.model_validate_json(
                response.choices[0].message.content
            )
            result = analysis.model_dump()
            
            logger.info("README Analysis Results:")
            logger.info(f"- Project Purpose: {result['project_purpose'][:100]}...")
            logger.info(f"- Core Features: {len(result['core_features'])} found")
            logger.info(f"- Key Components: {len(result['key_components'])} found")
            
            return result
            
        except Exception as e:
            self.errors_encountered += 1
            logger.error(f"Error analyzing README: {str(e)}", exc_info=True)
            return {
                "project_purpose": "",
                "core_features": [],
                "key_components": [],
                "important_patterns": [],
                "dependencies": []
            }
    
    async def evaluate_file_relevance(
        self, 
        file_path: str, 
        file_preview: str,
        project_context: Dict[str, any]
    ) -> FileRelevance:
        """Evaluate if a file is relevant using structured outputs."""
        self.files_processed += 1
        logger.info(f"\nEvaluating file [{self.files_processed}]: {file_path}")

        # Check if we can read the file
        content = read_file_safely(file_path)
        if content is None:
            self.binary_files_skipped += 1
            logger.info(f"Skipping binary/unreadable file: {file_path}")
            return FileRelevance(
                path=file_path,
                is_relevant=False,
                confidence=1.0,
                reason="Binary or unreadable file - skipping analysis"
            )

        try:
            logger.info(f"File preview length: {len(file_preview)} characters")
            start_time = time.time()

            prompt = f"""Given the project context and file information, output a JSON object with the following structure:
            {FILE_ANALYSIS_SCHEMA}
            
            Remember:
            - All fields are required
            - No additional properties are allowed
            - confidence must be a number between 0 and 1
            - is_relevant must be a boolean
            - reason must be a string explaining your decision

            Project Context:
            {json.dumps(project_context, indent=2)}

            File Path: {file_path}
            Content Preview:
            {content}

            Consider:
            1. Is this file essential for understanding the project's core functionality?
            2. Does it contain implementation details mentioned in the README?
            3. Is it a configuration file needed for project setup?
            4. Is it a core dependency or requirement file?
            """

            logger.info(f"Making API call to evaluate file: {file_path}")
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are an expert code analyst. You must output valid JSON matching the specified schema."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )

            api_time = time.time() - start_time
            logger.info(f"Received API response (took {api_time:.2f}s)")

            analysis = FileAnalysis.model_validate_json(
                response.choices[0].message.content
            )
            
            result = FileRelevance(
                path=file_path,
                is_relevant=analysis.is_relevant,
                confidence=analysis.confidence,
                reason=analysis.reason
            )

            logger.info("File Analysis Results:")
            logger.info(f"- Path: {result.path}")
            logger.info(f"- Relevant: {result.is_relevant}")
            logger.info(f"- Confidence: {result.confidence:.2f}")
            logger.info(f"- Reason: {result.reason}")

            logger.info("\nAnalysis Statistics:")
            logger.info(f"- Total files processed: {self.files_processed}")
            logger.info(f"- Binary files skipped: {self.binary_files_skipped}")
            logger.info(f"- Errors encountered: {self.errors_encountered}")
            
            return result
            
        except Exception as e:
            self.errors_encountered += 1
            logger.error(f"Error evaluating file {file_path}: {str(e)}", exc_info=True)
            return FileRelevance(
                path=file_path,
                is_relevant=True,  # Default to including file if evaluation fails
                confidence=0.0,
                reason=f"Evaluation failed: {str(e)}"
            )

    def get_statistics(self) -> Dict[str, int]:
        """Return current processing statistics."""
        return {
            "files_processed": self.files_processed,
            "binary_files_skipped": self.binary_files_skipped,
            "errors_encountered": self.errors_encountered
        }