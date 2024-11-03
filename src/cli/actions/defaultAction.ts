import path from 'node:path';
import { loadFileConfig, mergeConfigs } from '../../config/configLoad.js';
import type {
  RepopackConfigCli,
  RepopackConfigFile,
  RepopackConfigMerged,
  RepopackOutputStyle,
} from '../../config/configTypes.js';
import { type PackResult, pack } from '../../core/packager.js';
import { logger } from '../../shared/logger.js';
import { printCompletion, printSecurityCheck, printSummary, printTopFiles } from '../cliPrint.js';
import type { CliOptions } from '../cliRun.js';
import Spinner from '../cliSpinner.js';
import { AIBridge } from '../../ai/aiBridge.js';

export interface DefaultActionRunnerResult {
  packResult: PackResult;
  config: RepopackConfigMerged;
}

export const runDefaultAction = async (
  directory: string,
  cwd: string,
  options: CliOptions,
): Promise<DefaultActionRunnerResult> => {
  logger.trace('Loaded CLI options:', options);

  // Load the config file
  const fileConfig: RepopackConfigFile = await loadFileConfig(cwd, options.config ?? null);
  logger.trace('Loaded file config:', fileConfig);

  // Parse the CLI options into a config
  const cliConfig: RepopackConfigCli = buildCliConfig(options);
  logger.trace('CLI config:', cliConfig);

  // Merge default, file, and CLI configs
  const config: RepopackConfigMerged = mergeConfigs(cwd, fileConfig, cliConfig);
  logger.trace('Merged config:', config);

  const targetPath = path.resolve(directory);

  const spinner = new Spinner('Packing files...');
  spinner.start();

  let packResult: PackResult;

  try {
    packResult = await pack(targetPath, {
      ...config,
      ai: {
        ...config.ai,
        enabled: options.aiEnabled ?? config.ai.enabled,
        provider: options.aiProvider ?? config.ai.provider,
        relevanceThreshold: options.aiThreshold ?? config.ai.relevanceThreshold,
        maxTokens: options.aiMaxTokens ?? config.ai.maxTokens,
        modelName: options.aiModel ?? config.ai.modelName
      }
    }, (message: string) => {
      spinner.update(message);
    });
  } catch (error) {
    spinner.fail('Error during packing');
    throw error;
  }

  spinner.succeed('Packing completed successfully!');
  logger.log('');

  if (config.output.topFilesLength > 0) {
    printTopFiles(packResult.fileCharCounts, packResult.fileTokenCounts, config.output.topFilesLength);
    logger.log('');
  }

  printSecurityCheck(cwd, packResult.suspiciousFilesResults, config);
  logger.log('');

  printSummary(
    packResult.totalFiles,
    packResult.totalCharacters,
    packResult.totalTokens,
    config.output.filePath,
    packResult.suspiciousFilesResults,
    config,
  );
  logger.log('');

  printCompletion();

  return {
    packResult,
    config,
  };
};

const buildCliConfig = (options: CliOptions): RepopackConfigCli => {
  const cliConfig: RepopackConfigCli = {};

  if (options.output) {
    cliConfig.output = { filePath: options.output };
  }
  if (options.include) {
    cliConfig.include = options.include.split(',');
  }
  if (options.ignore) {
    cliConfig.ignore = { customPatterns: options.ignore.split(',') };
  }
  if (options.topFilesLen !== undefined) {
    cliConfig.output = { ...cliConfig.output, topFilesLength: options.topFilesLen };
  }
  if (options.outputShowLineNumbers !== undefined) {
    cliConfig.output = { ...cliConfig.output, showLineNumbers: options.outputShowLineNumbers };
  }
  if (options.style) {
    cliConfig.output = { ...cliConfig.output, style: options.style.toLowerCase() as RepopackOutputStyle };
  }

  // Add AI configuration from CLI options
  if (options.aiEnabled || options.aiProvider || options.aiThreshold || options.aiMaxTokens || options.aiModel) {
    cliConfig.ai = {
      enabled: options.aiEnabled ?? false,
      provider: options.aiProvider ?? 'openai',
      relevanceThreshold: options.aiThreshold ?? 0.7,
      maxTokens: options.aiMaxTokens ?? 4000,
      modelName: options.aiModel ?? 'gpt-4o'
    };
  }

  return cliConfig;
};