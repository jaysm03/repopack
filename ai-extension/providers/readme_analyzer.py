#readme_analyzer.py
from typing import Dict, List, Optional
from pathlib import Path
from pydantic import BaseModel
from openai import AsyncClient
import logging
import time
import json

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("ReadmeAnalyzer")

class RelevanceMetrics(BaseModel):
    score: float
    keywords_matched: List[str]
    context_relevance: float
    file_type_importance: float

class FileInsight(BaseModel):
    path: str
    type: str
    purpose: str
    relevance: RelevanceMetrics
    key_features: List[str]

class ReadmeSection(BaseModel):
    title: str
    content: str
    importance: float

class ProjectContext(BaseModel):
    main_purpose: str
    core_features: List[str]
    key_components: List[str]
    tech_stack: List[str]
    file_patterns: List[str]
    important_paths: List[str]

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
    
    # Handle files without extensions
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
        content.encode('ascii')
        return False
    except UnicodeEncodeError:
        try:
            content.encode('utf-8')
            return False
        except UnicodeEncodeError:
            return True

def read_file_safely(file_path: str, max_lines: int = 50) -> Optional[str]:
    """Safely read a file, returning None if it's binary or unreadable."""
    try:
        if is_definitely_binary(file_path):
            logger.debug(f"Skipping known binary file: {file_path}")
            return None
            
        if is_known_text_file(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                return "".join(f.readlines()[:max_lines])

        with open(file_path, 'r', encoding='utf-8') as f:
            content = "".join(f.readlines()[:max_lines])
            if is_binary_content(content):
                return None
            return content
            
    except (UnicodeDecodeError, OSError):
        logger.debug(f"Could not read file as text: {file_path}")
        return None

class ReadmeAnalyzer:
    def __init__(self, openai_client: AsyncClient):
        logger.info("Initializing ReadmeAnalyzer")
        self.client = openai_client
        self.files_processed = 0
        self.binary_files_skipped = 0
        self.errors_encountered = 0

    def load_readme(self, repo_path: str) -> Optional[str]:
        """Load README content from repository."""
        logger.info(f"Searching for README in repository: {repo_path}")
        readme_paths = [
            'README.md',
            'README.MD',
            'Readme.md',
            'readme.md',
            'README.markdown',
            'README'
        ]
        
        repo_path = Path(repo_path)
        for readme_name in readme_paths:
            readme_path = repo_path / readme_name
            logger.debug(f"Checking for README at: {readme_path}")
            if readme_path.exists():
                try:
                    content = read_file_safely(str(readme_path))
                    if content:
                        logger.info(f"Successfully loaded README from: {readme_path}")
                        logger.info(f"README size: {len(content)} characters")
                        return content
                except Exception as e:
                    logger.error(f"Error reading {readme_path}: {str(e)}")
                    continue
        logger.warning("No README file found in repository")
        return None

    async def analyze_readme(self, content: str) -> Dict:
        """Analyze README content using structured outputs with OpenAI."""
        logger.info("Starting README analysis")
        start_time = time.time()

        ANALYSIS_SCHEMA = {
            "type": "object",
            "properties": {
                "main_purpose": {"type": "string"},
                "core_features": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "key_components": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "tech_stack": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "file_patterns": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "important_paths": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            },
            "required": [
                "main_purpose",
                "core_features",
                "key_components",
                "tech_stack",
                "file_patterns",
                "important_paths"
            ],
            "additionalProperties": False
        }

        try:
            logger.info(f"Preparing to analyze README content of length: {len(content)}")
            prompt = f"""Analyze this README and output a JSON object with the following structure:
            {ANALYSIS_SCHEMA}
            
            Remember:
            - All fields are required
            - No additional properties are allowed
            - Arrays must contain strings
            
            Analyze this README and identify:
            1. Main purpose of the project
            2. Core features and functionality
            3. Key components and their roles
            4. Technology stack and dependencies
            5. Important file patterns to look for
            6. Critical file paths that should be included

            README Content:
            {content}"""

            logger.info("Making API call to analyze README...")
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system", 
                        "content": "You are an expert code analyst. Your output must be valid JSON matching the specified schema."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                response_format={"type": "json_object"}
            )

            api_time = time.time() - start_time
            logger.info(f"Received README analysis response (took {api_time:.2f}s)")

            # Parse into Pydantic model
            result = ProjectContext.model_validate_json(
                response.choices[0].message.content
            )
            
            analysis_result = result.model_dump()
            
            logger.info("README Analysis Results:")
            logger.info(f"- Main Purpose: {analysis_result['main_purpose'][:100]}...")
            logger.info(f"- Core Features: {len(analysis_result['core_features'])} found")
            logger.info(f"- Key Components: {len(analysis_result['key_components'])} found")
            logger.info(f"- Tech Stack: {len(analysis_result['tech_stack'])} items")
            logger.info(f"- File Patterns: {len(analysis_result['file_patterns'])} patterns")
            logger.info(f"- Important Paths: {len(analysis_result['important_paths'])} paths")
            
            return analysis_result

        except Exception as e:
            self.errors_encountered += 1
            logger.error(f"Error analyzing README: {str(e)}", exc_info=True)
            return {
                "main_purpose": "",
                "core_features": [],
                "key_components": [],
                "tech_stack": [],
                "file_patterns": [],
                "important_paths": []
            }

    async def evaluate_file_relevance(
        self,
        file_path: str,
        file_preview: str,
        project_context: ProjectContext
    ) -> FileInsight:
        """Evaluate a file's relevance using structured outputs."""
        self.files_processed += 1
        logger.info(f"\nEvaluating file [{self.files_processed}]: {file_path}")
        start_time = time.time()

        # Check if file is binary
        content = read_file_safely(file_path)
        if content is None:
            self.binary_files_skipped += 1
            logger.info(f"Skipping binary/unreadable file: {file_path}")
            return FileInsight(
                path=file_path,
                type="binary",
                purpose="Binary file - not analyzed",
                relevance=RelevanceMetrics(
                    score=0.0,
                    keywords_matched=[],
                    context_relevance=0.0,
                    file_type_importance=0.0
                ),
                key_features=[]
            )

        RELEVANCE_SCHEMA = {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "type": {"type": "string"},
                "purpose": {"type": "string"},
                "relevance": {
                    "type": "object",
                    "properties": {
                        "score": {"type": "number"},
                        "keywords_matched": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "context_relevance": {"type": "number"},
                        "file_type_importance": {"type": "number"}
                    },
                    "required": [
                        "score",
                        "keywords_matched",
                        "context_relevance",
                        "file_type_importance"
                    ],
                    "additionalProperties": False
                },
                "key_features": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            },
            "required": [
                "path",
                "type",
                "purpose",
                "relevance",
                "key_features"
            ],
            "additionalProperties": False
        }

        try:
            logger.info(f"File preview length: {len(content)} characters")
            prompt = f"""Evaluate this file and output a JSON object with the following structure:
            {RELEVANCE_SCHEMA}
            
            Remember:
            - All fields are required
            - No additional properties are allowed
            - Numbers must be between 0 and 1
            - Arrays must contain strings
            
            Project Context:
            {project_context.model_dump_json()}
            
            File Path: {file_path}
            Content Preview:
            {content}
            
            Evaluate the file's relevance to the project."""

            logger.info(f"Making API call to evaluate file: {file_path}")
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert code analyst. Output valid JSON matching the specified schema."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                response_format={"type": "json_object"}
            )

            api_time = time.time() - start_time
            logger.info(f"Received API response (took {api_time:.2f}s)")

            # Parse into Pydantic model
            result = FileInsight.model_validate_json(
                response.choices[0].message.content
            )

            logger.info("File Analysis Results:")
            logger.info(f"- Path: {result.path}")
            logger.info(f"- Type: {result.type}")
            logger.info(f"- Purpose: {result.purpose}")
            logger.info(f"- Relevance Score: {result.relevance.score:.2f}")
            logger.info(f"- Keywords Matched: {len(result.relevance.keywords_matched)}")
            logger.info(f"- Key Features: {len(result.key_features)}")

            logger.info("\nProcessing Statistics:")
            logger.info(f"- Total files processed: {self.files_processed}")
            logger.info(f"- Binary files skipped: {self.binary_files_skipped}")
            logger.info(f"- Errors encountered: {self.errors_encountered}")

            return result

        except Exception as e:
            self.errors_encountered += 1
            logger.error(f"Error evaluating file {file_path}: {str(e)}", exc_info=True)
            return FileInsight(
                path=file_path,
                type="unknown",
                purpose="Could not analyze",
                relevance=RelevanceMetrics(
                    score=0.5,
                    keywords_matched=[],
                    context_relevance=0.5,
                    file_type_importance=0.5
                ),
                key_features=[]
            )

    def get_statistics(self) -> Dict[str, int]:
        """Return current processing statistics."""
        return {
            "files_processed": self.files_processed,
            "binary_files_skipped": self.binary_files_skipped,
            "errors_encountered": self.errors_encountered
        }