import * as fs from 'fs';
import * as path from 'path';

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志配置
 */
export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  logDir: string;
  maxFileSize: number; // bytes
  maxFiles: number;
}

/**
 * 默认配置
 */
const defaultConfig: LoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  enableConsole: true,
  enableFile: true,
  logDir: process.env.LOG_DIR || './logs',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
};

/**
 * 日志级别数值
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 日志条目
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * 统一日志工具类
 */
export class Logger {
  private config: LoggerConfig;
  private currentLogFile: string | null = null;
  private currentLogSize: number = 0;
  private writeStream: fs.WriteStream | null = null;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.init();
  }

  /**
   * 初始化日志系统
   */
  private init(): void {
    if (this.config.enableFile) {
      this.ensureLogDir();
      this.rotateLog();
    }
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  /**
   * 获取日志文件路径
   */
  private getLogFilePath(): string {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.config.logDir, `app-${date}.log`);
  }

  /**
   * 执行日志轮转
   */
  private rotateLog(): void {
    const logFile = this.getLogFilePath();

    // 检查当前日志文件大小
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size >= this.config.maxFileSize) {
        this.archiveOldLogs();
      }
    }

    // 关闭旧的写入流
    if (this.writeStream) {
      this.writeStream.end();
    }

    // 创建新的写入流
    this.currentLogFile = logFile;
    this.writeStream = fs.createWriteStream(logFile, { flags: 'a' });
    this.currentLogSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  }

  /**
   * 归档旧日志
   */
  private archiveOldLogs(): void {
    const date = new Date().toISOString().split('T')[0];
    const baseFile = path.join(this.config.logDir, `app-${date}`);

    // 移动现有日志文件
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldFile = `${baseFile}.${i}.log`;
      const newFile = `${baseFile}.${i + 1}.log`;
      if (fs.existsSync(oldFile)) {
        if (i === this.config.maxFiles - 1) {
          fs.unlinkSync(oldFile);
        } else {
          fs.renameSync(oldFile, newFile);
        }
      }
    }

    // 重命名当前日志文件
    const currentFile = `${baseFile}.log`;
    if (fs.existsSync(currentFile)) {
      fs.renameSync(currentFile, `${baseFile}.1.log`);
    }
  }

  /**
   * 格式化日志条目
   */
  private formatLog(entry: LogEntry): string {
    const meta = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${meta}\n`;
  }

  /**
   * 写入日志
   */
  private write(entry: LogEntry): void {
    // 检查日志级别
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.config.level]) {
      return;
    }

    const formatted = this.formatLog(entry);

    // 控制台输出
    if (this.config.enableConsole) {
      const consoleMethod = entry.level === 'error' ? console.error :
                           entry.level === 'warn' ? console.warn :
                           entry.level === 'debug' ? console.debug : console.log;
      consoleMethod(formatted.trim());
    }

    // 文件输出
    if (this.config.enableFile && this.writeStream) {
      this.writeStream.write(formatted);
      this.currentLogSize += Buffer.byteLength(formatted);

      // 检查是否需要轮转
      if (this.currentLogSize >= this.config.maxFileSize) {
        this.rotateLog();
      }
    }
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
    };
    this.write(entry);
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.log('warn', message, metadata);
  }

  error(message: string, error?: Error | unknown, metadata?: Record<string, any>): void {
    const errorMeta = error instanceof Error ? {
      errorMessage: error.message,
      errorStack: error.stack,
      ...metadata,
    } : metadata;
    this.log('error', message, errorMeta);
  }

  /**
   * 关闭日志系统
   */
  close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

// 导出单例实例
export const logger = new Logger();

// 导出便捷函数
export const log = {
  debug: (message: string, metadata?: Record<string, any>) => logger.debug(message, metadata),
  info: (message: string, metadata?: Record<string, any>) => logger.info(message, metadata),
  warn: (message: string, metadata?: Record<string, any>) => logger.warn(message, metadata),
  error: (message: string, error?: Error | unknown, metadata?: Record<string, any>) => 
    logger.error(message, error, metadata),
};

export default logger;
