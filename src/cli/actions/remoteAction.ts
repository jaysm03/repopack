//remoteAction.ts
import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import pc from 'picocolors';
import { RepopackError } from '../../shared/errorHandle.js';
import { logger } from '../../shared/logger.js';
import type { CliOptions } from '../cliRun.js';
import Spinner from '../cliSpinner.js';
import { runDefaultAction } from './defaultAction.js';

const execAsync = promisify(exec);

const runRemoteAction = async (repoUrl: string, options: CliOptions): Promise<void> => {
  const gitInstalled = await checkGitInstallation();
  if (!gitInstalled) {
    throw new RepopackError('Git is not installed or not in the system PATH.');
  }

  const formattedUrl = formatGitUrl(repoUrl);
  const tempDir = await createTempDirectory();
  const spinner = new Spinner('Cloning repository...');

  try {
    spinner.start();
    await cloneRepository(formattedUrl, tempDir);
    spinner.succeed('Repository cloned successfully!');
    logger.log('');

    // Prepare AI options
    const aiOptions: CliOptions = {
      ...options,
      aiEnabled: options.aiEnabled ?? true,
      aiProvider: options.aiProvider ?? 'openai',
      aiModel: options.aiModel ?? 'gpt-4o',
      aiThreshold: options.aiThreshold ?? 0.7,
      aiMaxTokens: options.aiMaxTokens ?? 4000
    };

    // Log AI settings if enabled
    if (aiOptions.aiEnabled) {
      logger.log(pc.cyan('\n🤖 AI Analysis Settings:'));
      logger.log(pc.dim('───────────────────'));
      logger.log(`Provider: ${pc.white(aiOptions.aiProvider)}`);
      logger.log(`Model: ${pc.white(aiOptions.aiModel)}`);
      logger.log(`Threshold: ${pc.white(aiOptions.aiThreshold?.toString())}`);
      logger.log('');
    }

    const result = await runDefaultAction(tempDir, tempDir, aiOptions);
    await copyOutputToCurrentDirectory(tempDir, process.cwd(), result.config.output.filePath);

  } finally {
    // Clean up the temporary directory
    await cleanupTempDirectory(tempDir);
  }
};

const formatGitUrl = (url: string): string => {
  // If the URL is in the format owner/repo, convert it to a GitHub URL
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(url)) {
    logger.trace(`Formatting GitHub shorthand: ${url}`);
    return `https://github.com/${url}.git`;
  }

  // Add .git to HTTPS URLs if missing
  if (url.startsWith('https://') && !url.endsWith('.git')) {
    logger.trace(`Adding .git to HTTPS URL: ${url}`);
    return `${url}.git`;
  }

  return url;
};

const createTempDirectory = async (): Promise<string> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repopack-'));
  logger.trace(`Created temporary directory. (path: ${pc.dim(tempDir)})`);
  return tempDir;
};

const cloneRepository = async (url: string, directory: string): Promise<void> => {
  logger.log(`Clone repository: ${url} to temporary directory. ${pc.dim(`path: ${directory}`)}`);
  logger.log('');

  try {
    // Using --depth 1 for a shallow clone to speed up the process
    await execAsync(`git clone --depth 1 ${url} ${directory}`);
  } catch (error) {
    throw new RepopackError(`Failed to clone repository: ${(error as Error).message}`);
  }
};

const cleanupTempDirectory = async (directory: string): Promise<void> => {
  logger.trace(`Cleaning up temporary directory: ${directory}`);
  await fs.rm(directory, { recursive: true, force: true });
};

const checkGitInstallation = async (): Promise<boolean> => {
  try {
    const result = await execAsync('git --version');
    if (result.stderr) {
      return false;
    }
    return true;
  } catch (error) {
    logger.debug('Git is not installed:', (error as Error).message);
    return false;
  }
};

const copyOutputToCurrentDirectory = async (
  sourceDir: string,
  targetDir: string,
  outputFileName: string,
): Promise<void> => {
  const sourcePath = path.join(sourceDir, outputFileName);
  const targetPath = path.join(targetDir, outputFileName);

  try {
    logger.trace(`Copying output file from: ${sourcePath} to: ${targetPath}`);
    await fs.copyFile(sourcePath, targetPath);
    
    // Log success message with file path
    logger.success(`\nOutput file created: ${pc.green(outputFileName)}`);
    logger.log(`Location: ${pc.dim(targetPath)}`);
  } catch (error) {
    throw new RepopackError(`Failed to copy output file: ${(error as Error).message}`);
  }
};

interface RemoteAnalysisResult {
  totalFiles: number;
  relevantFiles: number;
  outputPath: string;
  aiEnabled: boolean;
  aiMetrics?: {
    avgRelevance: number;
    highRelevanceFiles: number;
    processedWithAI: boolean;
  };
}

const logAnalysisResults = (result: RemoteAnalysisResult): void => {
  logger.log(pc.cyan('\n📊 Analysis Results:'));
  logger.log(pc.dim('─────────────────'));
  logger.log(`Total Files Analyzed: ${pc.white(result.totalFiles.toString())}`);
  logger.log(`Relevant Files: ${pc.white(result.relevantFiles.toString())}`);

  if (result.aiEnabled && result.aiMetrics) {
    logger.log(pc.cyan('\n🤖 AI Metrics:'));
    logger.log(pc.dim('────────────'));
    logger.log(`Average Relevance: ${pc.white((result.aiMetrics.avgRelevance * 100).toFixed(1))}%`);
    logger.log(`High Relevance Files: ${pc.white(result.aiMetrics.highRelevanceFiles.toString())}`);
  }

  logger.log('');
};

export {
  runRemoteAction,
  formatGitUrl,
  createTempDirectory,
  cloneRepository,
  cleanupTempDirectory,
  checkGitInstallation,
  copyOutputToCurrentDirectory,
  logAnalysisResults,
  type RemoteAnalysisResult
};