export type RepopackOutputStyle = 'plain' | 'xml' | 'markdown';

export interface AIConfig {
  enabled: boolean;
  provider: 'openai' | 'claude';
  relevanceThreshold: number;
  maxTokens?: number;
  modelName?: string;
}

// Base configuration interface with all optional fields
interface RepopackConfigBase {
  output?: {
    filePath?: string;
    style?: RepopackOutputStyle;
    headerText?: string | null;  // Made nullable
    instructionFilePath?: string | null;  // Made nullable
    removeComments?: boolean;
    removeEmptyLines?: boolean;
    topFilesLength?: number;
    showLineNumbers?: boolean;
  };
  include?: string[];
  ignore?: {
    useGitignore?: boolean;
    useDefaultPatterns?: boolean;
    customPatterns?: string[];
  };
  security?: {
    enableSecurityCheck?: boolean;
  };
  ai?: Partial<AIConfig>;
}

// Default configuration with required fields
export type RepopackConfigDefault = {
  output: {
    filePath: string;
    style: RepopackOutputStyle;
    headerText: string | null;
    instructionFilePath: string | null;
    removeComments: boolean;
    removeEmptyLines: boolean;
    topFilesLength: number;
    showLineNumbers: boolean;
  };
  include: string[];
  ignore: {
    useGitignore: boolean;
    useDefaultPatterns: boolean;
    customPatterns: string[];
  };
  security: {
    enableSecurityCheck: boolean;
  };
  ai: AIConfig;
};

export type RepopackConfigFile = RepopackConfigBase;

export type RepopackConfigCli = RepopackConfigBase & {
  verbose?: boolean;
  init?: boolean;
  global?: boolean;
  remote?: string;
};

export type RepopackConfigMerged = RepopackConfigDefault &
  RepopackConfigFile &
  RepopackConfigCli & {
    cwd: string;
  };

export type ConfigValidationResult = {
  isValid: boolean;
  errors: string[];
};

export type ConfigUpdate = Partial<RepopackConfigMerged>;

export function isValidOutputStyle(style: string): style is RepopackOutputStyle {
  return ['plain', 'xml', 'markdown'].includes(style);
}

export function isValidAIProvider(provider: string): provider is AIConfig['provider'] {
  return ['openai', 'claude'].includes(provider);
}

export interface ConfigValidationOptions {
  validatePaths?: boolean;
  validateAIConfig?: boolean;
  validateOutputStyle?: boolean;
}