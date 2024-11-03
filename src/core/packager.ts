import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import pMap from 'p-map';
import pc from 'picocolors';
import { AIBridge } from '../ai/aiBridge.js';
import type { RepopackConfigMerged } from '../config/configTypes.js';
import { logger } from '../shared/logger.js';
import { getProcessConcurrency } from '../shared/processConcurrency.js';
import type { RepopackProgressCallback } from '../shared/types.js';
import { collectFiles as defaultCollectFiles } from './file/fileCollect.js';
import { processFiles as defaultProcessFiles } from './file/fileProcess.js';
import { searchFiles as defaultSearchFiles } from './file/fileSearch.js';
import { generateOutput as defaultGenerateOutput } from './output/outputGenerate.js';
import { type SuspiciousFileResult, runSecurityCheck as defaultRunSecurityCheck } from './security/securityCheck.js';
import { TokenCounter } from './tokenCount/tokenCount.js';

export interface PackDependencies {
  searchFiles: typeof defaultSearchFiles;
  collectFiles: typeof defaultCollectFiles;
  processFiles: typeof defaultProcessFiles;
  runSecurityCheck: typeof defaultRunSecurityCheck;
  generateOutput: typeof defaultGenerateOutput;
}

export interface PackResult {
  totalFiles: number;
  totalCharacters: number;
  totalTokens: number;
  fileCharCounts: Record<string, number>;
  fileTokenCounts: Record<string, number>;
  suspiciousFilesResults: SuspiciousFileResult[];
  aiAnalysis?: {
    relevantFiles: string[];
    excludedFiles: string[];
    projectContext: Record<string, any>;
  };
}

export const pack = async (
  rootDir: string,
  config: RepopackConfigMerged,
  progressCallback: RepopackProgressCallback = () => {},
  deps: PackDependencies = {
    searchFiles: defaultSearchFiles,
    collectFiles: defaultCollectFiles,
    processFiles: defaultProcessFiles,
    runSecurityCheck: defaultRunSecurityCheck,
    generateOutput: defaultGenerateOutput,
  },
): Promise<PackResult> => {
  // Get all file paths considering the config
  progressCallback('Searching for files...');
  const filePaths = await deps.searchFiles(rootDir, config);

  // AI Analysis if enabled
  let aiAnalysis;
  if (config.ai?.enabled) {
    progressCallback('Running AI analysis...');
    try {
      const aiBridge = new AIBridge();
      aiAnalysis = await aiBridge.analyzeRepository(rootDir, config);
      logger.trace('AI Analysis completed:', aiAnalysis);
    } catch (error) {
      logger.warn('AI analysis failed, proceeding with default processing:', error);
    }
  }

  // Filter files based on AI analysis if available
  const relevantPaths = aiAnalysis 
    ? filePaths.filter(path => aiAnalysis.relevantFiles.includes(path))
    : filePaths;

  // Collect raw files
  progressCallback('Collecting files...');
  const rawFiles = await deps.collectFiles(relevantPaths, rootDir);

  let safeRawFiles = rawFiles;
  let suspiciousFilesResults: SuspiciousFileResult[] = [];

  if (config.security.enableSecurityCheck) {
    // Perform security check and filter out suspicious files
    progressCallback('Running security check...');
    suspiciousFilesResults = await deps.runSecurityCheck(rawFiles, progressCallback);
    safeRawFiles = rawFiles.filter(
      (rawFile) => !suspiciousFilesResults.some((result) => result.filePath === rawFile.path),
    );
  }

  const safeFilePaths = safeRawFiles.map((file) => file.path);
  logger.trace('Safe files count:', safeRawFiles.length);

  // Process files (remove comments, etc.)
  progressCallback('Processing files...');
  const processedFiles = await deps.processFiles(safeRawFiles, config);

  // Generate output
  progressCallback('Generating output...');
  const output = await deps.generateOutput(rootDir, config, processedFiles, safeFilePaths);

  // Write output to file. path is relative to the cwd
  progressCallback('Writing output file...');
  const outputPath = path.resolve(config.cwd, config.output.filePath);
  logger.trace(`Writing output to: ${outputPath}`);
  await fs.writeFile(outputPath, output);

  // Setup token counter
  const tokenCounter = new TokenCounter();

  // Metrics
  progressCallback('Calculating metrics...');
  const fileMetrics = await pMap(
    processedFiles,
    async (file, index) => {
      const charCount = file.content.length;
      const tokenCount = tokenCounter.countTokens(file.content, file.path);

      progressCallback(`Calculating metrics... (${index + 1}/${processedFiles.length}) ${pc.dim(file.path)}`);

      // Sleep for a short time to prevent blocking the event loop
      await setTimeout(1);

      return { path: file.path, charCount, tokenCount };
    },
    {
      concurrency: getProcessConcurrency(),
    },
  );

  tokenCounter.free();

  const totalFiles = processedFiles.length;
  const totalCharacters = fileMetrics.reduce((sum, fileMetric) => sum + fileMetric.charCount, 0);
  const totalTokens = fileMetrics.reduce((sum, fileMetric) => sum + fileMetric.tokenCount, 0);

  const fileCharCounts: Record<string, number> = {};
  const fileTokenCounts: Record<string, number> = {};
  for (const file of fileMetrics) {
    fileCharCounts[file.path] = file.charCount;
    fileTokenCounts[file.path] = file.tokenCount;
  }

  return {
    totalFiles,
    totalCharacters,
    totalTokens,
    fileCharCounts,
    fileTokenCounts,
    suspiciousFilesResults,
    aiAnalysis: aiAnalysis ? {
      relevantFiles: aiAnalysis.relevantFiles,
      excludedFiles: filePaths.filter(path => !aiAnalysis.relevantFiles.includes(path)),
      projectContext: aiAnalysis.projectContext
    } : undefined
  };
};