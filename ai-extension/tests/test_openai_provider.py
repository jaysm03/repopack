import pytest
from unittest.mock import Mock, patch
from ..providers.openai_provider import OpenAIProvider

@pytest.mark.asyncio
async def test_readme_analysis():
    mock_response = Mock()
    mock_response.choices = [
        Mock(message=Mock(content={
            "project_purpose": "Test project",
            "core_features": ["feature1"],
            "key_components": ["component1"],
            "important_patterns": ["pattern1"],
            "dependencies": ["dep1"]
        }))
    ]
    
    with patch('openai.Client') as mock_client:
        mock_client.return_value.chat.completions.create.return_value = mock_response
        provider = OpenAIProvider("test_key")
        result = await provider.analyze_readme("Test README content")
        assert "project_purpose" in result
        assert "core_features" in result