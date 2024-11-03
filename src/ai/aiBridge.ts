// aiBridge.ts
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import type { RepopackConfigMerged } from '../config/configTypes.js';
import { logger } from '../shared/logger.js';
import { RepopackError } from '../shared/errorHandle.js';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');

// Load environment variables
dotenv.config({ path: envPath });

interface AIAnalysisResult {
  relevantFiles: string[];
  projectContext: Record<string, any>;
  error?: string;
}

interface AIMetrics {
  totalFiles: number;
  relevantFiles: number;
  averageConfidence: number;
  processingTime: number;
}

export class AIBridge {
  private pythonPath: string;
  private extensionPath: string;
  
  constructor(pythonPath = 'python3') {
    this.pythonPath = pythonPath;
    this.extensionPath = path.resolve(__dirname, '../../ai-extension');
    
    // Load environment variables again in case they weren't loaded
    if (!process.env.OPENAI_API_KEY) {
      dotenv.config({ path: envPath });
    }
  }

  private checkEnvironment(): void {
    logger.debug('Checking environment...');
    logger.debug(`Environment file path: ${envPath}`);
    logger.debug(`API Key status: ${process.env.OPENAI_API_KEY ? 'Present' : 'Missing'}`);
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new RepopackError(
        'OPENAI_API_KEY environment variable is not set. Please check your .env file.'
      );
    }
    
    if (apiKey === 'your-key' || apiKey === 'exampleAPIkey') {
      throw new RepopackError(
        'Please update the OPENAI_API_KEY in your .env file with your actual API key.'
      );
    }
    
    // Validate API key format (basic check)
    if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
      throw new RepopackError(
        'The OPENAI_API_KEY appears to be invalid. Please check your API key format.'
      );
    }
  }

  private validatePythonSetup(): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn(this.pythonPath, ['-c', 'import openai']);
      
      pythonProcess.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(new Error('Required Python packages are not installed. Please install the openai package.'));
        }
        resolve();
      });
    });
  }

  public async analyzeRepository(
    repoPath: string,
    config: RepopackConfigMerged
  ): Promise<AIAnalysisResult> {
    const startTime = Date.now();
    
    try {
      this.checkEnvironment();
      await this.validatePythonSetup();

      logger.debug('Starting AI analysis...');
      logger.debug(`Extension path: ${this.extensionPath}`);
      logger.debug(`Repository path: ${repoPath}`);
      
      const scriptPath = path.join(this.extensionPath, 'analyze.py');
      
      try {
        await import('fs/promises').then(fs => fs.access(scriptPath));
        logger.debug(`Found analyze.py at: ${scriptPath}`);
      } catch {
        throw new RepopackError(`AI analysis script not found at: ${scriptPath}`);
      }

      return new Promise((resolve, reject) => {
        const nodeProcess = process;
        const childProcess: ChildProcess = spawn(this.pythonPath, [
          scriptPath,
          repoPath,
          '--config', JSON.stringify({
            ...config,
            relevanceThreshold: config.ai?.relevanceThreshold ?? 0.7,
            maxTokens: config.ai?.maxTokens ?? 4000,
            modelName: config.ai?.modelName ?? 'gpt-4o'
          })
        ], {
          env: {
            ...nodeProcess.env,
            PYTHONPATH: this.extensionPath,
            PYTHONUNBUFFERED: '1',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY
          }
        });

        let output = '';
        let error = '';

        childProcess.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          output += chunk;
          logger.debug(`AI Output: ${chunk.trim()}`);
        });

        childProcess.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          error += chunk;
          logger.debug(`AI Error: ${chunk.trim()}`);
        });

        childProcess.on('error', (err: Error) => {
          reject(new RepopackError(`Failed to start AI analysis: ${err.message}`));
        });

        childProcess.on('close', (code: number | null) => {
          const processingTime = Date.now() - startTime;
          
          if (code !== 0) {
            logger.debug(`AI analysis failed with code ${code}`);
            logger.debug(`Error output: ${error}`);
            reject(new RepopackError(`AI analysis failed: ${error}`));
            return;
          }

          try {
            const result = JSON.parse(output) as AIAnalysisResult;
            
            const metrics: AIMetrics = {
              totalFiles: result.relevantFiles?.length || 0,
              relevantFiles: result.relevantFiles?.length || 0,
              averageConfidence: result.projectContext?.confidence || 0,
              processingTime
            };
            
            logger.debug('AI Analysis Metrics:', metrics);
            
            resolve(result);
          } catch (err) {
            const error = err as Error;
            logger.debug('Failed to parse AI output:', output);
            reject(new RepopackError(`Failed to parse AI analysis result: ${error.message}`));
          }
        });
      });
    } catch (err) {
      const error = err as Error;
      logger.debug('AI analysis error:', error);
      throw error instanceof RepopackError ? error : new RepopackError(error.message);
    }
  }

  public async checkAICapabilities(): Promise<boolean> {
    try {
      await this.validatePythonSetup();
      this.checkEnvironment();
      return true;
    } catch (error) {
      logger.debug('AI capabilities check failed:', error);
      return false;
    }
  }
}