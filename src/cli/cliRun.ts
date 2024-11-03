//cliRun.ts
import process from 'node:process';
import { type OptionValues, program } from 'commander';
import pc from 'picocolors';
import type { RepopackOutputStyle } from '../config/configTypes.js';
import { getVersion } from '../core/file/packageJsonParse.js';
import { handleError } from '../shared/errorHandle.js';
import { logger } from '../shared/logger.js';
import { runDefaultAction } from './actions/defaultAction.js';
import { runInitAction } from './actions/initAction.js';
import { runRemoteAction } from './actions/remoteAction.js';
import { runVersionAction } from './actions/versionAction.js';

export interface CliOptions extends OptionValues {
  version?: boolean;
  output?: string;
  include?: string;
  ignore?: string;
  config?: string;
  verbose?: boolean;
  topFilesLen?: number;
  outputShowLineNumbers?: boolean;
  style?: RepopackOutputStyle;
  init?: boolean;
  global?: boolean;
  remote?: string;
  // AI-specific options
  aiEnabled?: boolean;
  aiProvider?: 'openai' | 'claude';
  aiThreshold?: number;
  aiModel?: string;
  aiMaxTokens?: number;
}

export async function run() {
  try {
    const version = await getVersion();

    program
      .description('Repopack - Pack your repository into a single AI-friendly file')
      .arguments('[directory]')
      // Original options
      .option('-v, --version', 'show version information')
      .option('-o, --output <file>', 'specify the output file name')
      .option('--include <patterns>', 'list of include patterns (comma-separated)')
      .option('-i, --ignore <patterns>', 'additional ignore patterns (comma-separated)')
      .option('-c, --config <path>', 'path to a custom config file')
      .option('--top-files-len <number>', 'specify the number of top files to display', Number.parseInt)
      .option('--output-show-line-numbers', 'add line numbers to each line in the output')
      .option('--style <type>', 'specify the output style (plain, xml, markdown)')
      .option('--verbose', 'enable verbose logging for detailed output')
      .option('--init', 'initialize a new repopack.config.json file')
      .option('--global', 'use global configuration (only applicable with --init)')
      .option('--remote <url>', 'process a remote Git repository')
      // AI-specific options
      .option('--ai-enabled', 'enable AI-powered analysis')
      .option(
        '--ai-provider <provider>', 
        'AI provider to use (openai or claude)', 
        'openai'
      )
      .option(
        '--ai-threshold <number>', 
        'relevance threshold for AI analysis (0.0-1.0)', 
        parseFloat,
        0.7
      )
      .option(
        '--ai-model <model>', 
        'specific AI model to use', 
        'gpt-4o'
      )
      .option(
        '--ai-max-tokens <number>', 
        'maximum tokens for AI analysis', 
        Number.parseInt,
        4000
      )
      .action((directory = '.', options: CliOptions = {}) => executeAction(directory, process.cwd(), options));

    await program.parseAsync(process.argv);
  } catch (error) {
    handleError(error);
  }
}

const executeAction = async (directory: string, cwd: string, options: CliOptions) => {
  logger.setVerbose(options.verbose || false);

  if (options.version) {
    await runVersionAction();
    return;
  }

  const version = await getVersion();
  logger.log(pc.dim(`\n📦 Repopack v${version}\n`));

  if (options.init) {
    await runInitAction(cwd, options.global || false);
    return;
  }

  if (options.remote) {
    await runRemoteAction(options.remote, options);
    return;
  }

  // Log AI settings if enabled
  if (options.aiEnabled) {
    logger.log(pc.cyan('\n🤖 AI Analysis Enabled:'));
    logger.log(pc.dim('──────────────────────'));
    logger.log(`Provider: ${pc.white(options.aiProvider || 'openai')}`);
    logger.log(`Model: ${pc.white(options.aiModel || 'gpt-4o')}`);
    logger.log(`Threshold: ${pc.white(options.aiThreshold?.toString() || '0.7')}`);
    logger.log('');
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable must be set when using AI analysis");
  }
  }

  await runDefaultAction(directory, cwd, options);
};