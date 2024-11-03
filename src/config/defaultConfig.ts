import type { RepopackConfigDefault, RepopackOutputStyle } from './configTypes.js';

export const defaultFilePathMap: Record<RepopackOutputStyle, string> = {
  plain: 'repopack-output.txt',
  markdown: 'repopack-output.md',
  xml: 'repopack-output.xml',
};

export const defaultConfig: RepopackConfigDefault = {
  output: {
    filePath: defaultFilePathMap.plain,
    style: 'plain',
    headerText: null,
    instructionFilePath: null,
    removeComments: false,
    removeEmptyLines: false,
    topFilesLength: 5,
    showLineNumbers: false,
  },
  include: [],
  ignore: {
    useGitignore: true,
    useDefaultPatterns: true,
    customPatterns: [],
  },
  security: {
    enableSecurityCheck: true,
  },
  ai: {
    enabled: false,
    provider: 'openai',
    relevanceThreshold: 0.7,
    maxTokens: 4000,
    modelName: 'gpt-4o'
  }
};