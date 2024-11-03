#analyze.py
import asyncio
import json
import os
import sys
from typing import Dict, List, Set
from pathlib import Path
import argparse
import logging
import time
from openai import AsyncClient

from providers.openai_provider import OpenAIProvider
from providers.readme_analyzer import ReadmeAnalyzer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("Analyzer")

def get_default_ignore_patterns() -> Set[str]:
    """Get default patterns to ignore."""
    return {
        '__pycache__',
        '*.pyc',
        '*.pyo',
        '*.pyd',
        '.git',
        '.svn',
        '.hg',
        '.bzr',
        '.tox',
        '*.egg',
        '*.egg-info',
        'dist',
        'build',
        '_build',
        'node_modules',
        'venv',
        '.env',
        '.venv',
        '.DS_Store',
        'Thumbs.db'
    }

def should_ignore_file(file_path: str, ignore_patterns: Set[str]) -> bool:
    """Check if a file should be ignored based on patterns."""
    path_parts = Path(file_path).parts
    return any(
        any(part.startswith(pattern) or part.endswith(pattern)
        for part in path_parts)
        for pattern in ignore_patterns
    )

async def analyze_repository(
    repo_path: str,
    config: Dict,
    api_key: str
) -> Dict:
    """Main repository analysis function."""
    start_time = time.time()
    logger.info(f"Starting analysis of repository: {repo_path}")
    logger.info(f"Configuration: {json.dumps(config, indent=2)}")

    try:
        # Initialize OpenAI client and analyzers
        logger.info("Initializing OpenAI client and analyzers...")
        client = AsyncClient(api_key=api_key)
        readme_analyzer = ReadmeAnalyzer(client)
        ai_provider = OpenAIProvider(api_key)

        # Load and analyze README
        logger.info("Loading README file...")
        readme_content = readme_analyzer.load_readme(repo_path)
        if not readme_content:
            logger.error("No README file found in repository")
            return {
                "error": "README not found",
                "relevantFiles": [],
                "projectContext": {}
            }

        # Analyze project context
        logger.info("Analyzing README content...")
        project_context = await readme_analyzer.analyze_readme(readme_content)
        logger.info("README analysis complete")
        logger.info(f"Project purpose: {project_context.get('main_purpose', '')[:100]}...")

        # Get all files in repository
        repo_path = Path(repo_path)
        logger.info("Scanning repository for files...")
        ignore_patterns = get_default_ignore_patterns()
        
        all_files = []
        for file_path in repo_path.rglob("*"):
            if file_path.is_file():
                relative_path = str(file_path.relative_to(repo_path))
                if not should_ignore_file(relative_path, ignore_patterns):
                    all_files.append(relative_path)

        logger.info(f"Found {len(all_files)} files in repository")

        # Evaluate each file
        relevant_files = []
        threshold = config.get("relevanceThreshold", 0.7)
        max_preview_lines = config.get("maxPreviewLines", 50)
        files_processed = 0
        binary_files = 0
        errors = 0

        logger.info(f"Starting file analysis with threshold: {threshold}")
        for file_path in all_files:
            files_processed += 1
            full_path = repo_path / file_path
            logger.info(f"Processing file [{files_processed}/{len(all_files)}]: {file_path}")
            
            try:
                # Evaluate relevance
                evaluation = await ai_provider.evaluate_file_relevance(
                    str(full_path), 
                    file_path,
                    project_context
                )

                if evaluation.is_relevant and evaluation.confidence >= threshold:
                    relevant_files.append(file_path)
                    logger.info(f"File marked as relevant: {file_path} (confidence: {evaluation.confidence:.2f})")

            except Exception as e:
                errors += 1
                logger.error(f"Error processing {file_path}: {str(e)}", exc_info=True)
                continue

        # Prepare final results
        elapsed_time = time.time() - start_time
        stats = {
            "total_files": len(all_files),
            "files_processed": files_processed,
            "binary_files": binary_files,
            "errors": errors,
            "relevant_files": len(relevant_files),
            "processing_time": f"{elapsed_time:.2f}s"
        }
        
        logger.info("Analysis complete!")
        logger.info("Statistics:")
        for key, value in stats.items():
            logger.info(f"- {key}: {value}")

        return {
            "relevantFiles": relevant_files,
            "projectContext": project_context,
            "statistics": stats
        }

    except Exception as e:
        logger.error(f"Critical error during analysis: {str(e)}", exc_info=True)
        return {
            "error": str(e),
            "relevantFiles": [],
            "projectContext": {}
        }

async def main():
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("repo_path", help="Path to repository")
        parser.add_argument("--config", help="Repopack configuration")
        args = parser.parse_args()

        # Load config
        config = json.loads(args.config)
        
        # Get API key from environment
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY environment variable not set")

        # Run analysis
        result = await analyze_repository(args.repo_path, config, api_key)
        
        # Output results
        print(json.dumps(result))

    except Exception as e:
        logger.error(f"Fatal error: {str(e)}", exc_info=True)
        print(json.dumps({
            "error": str(e),
            "relevantFiles": [],
            "projectContext": {}
        }))
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())