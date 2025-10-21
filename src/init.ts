import { mkdir, stat, cp, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { logError, logWarning, logInfo, logSuccess } from './util';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

async function directoryExists(dirPath: string): Promise<boolean> {
    try {
        const stats = await stat(dirPath);
        return stats.isDirectory();
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return false;
        }
        logError('Failed to check directory status:', error);
        throw error;
    }
}

async function main() {
    logInfo('🚀 Starting new project initialization...');

    const defaultBasePath = join(import.meta.dir, '..', '..');

    const argv = await yargs(hideBin(process.argv))
        .usage('Usage: bun run init.ts --projectName <name> [options]')
        .option('projectName', {
            alias: 'pn',
            type: 'string',
            description: 'Name of the new project.',
            demandOption: true,
        })
        .option('basePath', {
            alias: 'bp',
            type: 'string',
            description: 'Base path for translations projects.',
            default: defaultBasePath,
        })
        .help()
        .alias('help', 'h')
        .parse();

    const projectName = argv.projectName.trim();
    const basePath = argv.basePath;
    const templateDir = join(import.meta.dir, '..', 'template');
    const projectDir = join(basePath, projectName);

    logInfo(`Project Name: ${projectName}`);
    logInfo(`Project Location: ${projectDir}`);

    logInfo('🕵️  Validating parameters...');
    if (!projectName) {
        logWarning('No project name provided. Exiting.');
        return;
    }

    if (/[<>:"/\\|?*]/.test(projectName)) {
        logError('Project name contains invalid characters. Aborting.');
        return;
    }

    if (await directoryExists(projectDir)) {
        logError(`A directory named "${projectName}" already exists. Aborting.`);
        return;
    }
    logSuccess('✅ Validation successful.');

    let projectCreated = false;

    try {
        logInfo(`\n✨ Creating project directory at: ${projectDir}`);
        await mkdir(projectDir, { recursive: true });
        projectCreated = true;

        logInfo(`📁 Reading template files from: ${templateDir}`);
        const templateItems = await readdir(templateDir);

        logInfo(`🚛 Copying ${templateItems.length} template items in parallel...`);

        const copyPromises = templateItems.map((item) => {
            const sourcePath = join(templateDir, item);
            const destPath = join(projectDir, item);
            return cp(sourcePath, destPath, { recursive: true });
        });

        const results = await Promise.allSettled(copyPromises);

        const failedCopies = results.filter(
            (r) => r.status === 'rejected'
        );

        if (failedCopies.length > 0) {
            logError('Some files failed to copy:');
            for (const failure of failedCopies) {
                logError(` - ${(failure as PromiseRejectedResult).reason}`);
            }
            throw new Error('Failed to copy all template files.');
        }

        logSuccess(`\n🎉 Project "${projectName}" created successfully!`);
        logInfo(` └── Location: ${projectDir}`);

    } catch (error: any) {
        logError(`\n❌ Error during project setup: ${error.message}`);

        if (projectCreated) {
            logWarning('Attempting to clean up partially created directory...');
            try {
                await rm(projectDir, { recursive: true, force: true });
                logSuccess('🧹 Cleanup successful.');
            } catch (cleanupError) {
                logError('Failed to clean up directory:', cleanupError);
            }
        }
        process.exit(1);
    }
}

main();