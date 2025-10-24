import prompts from 'prompts';
import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';
import { logError, logWarning } from './util';

const SCRIPT_DIR = join(import.meta.dir);
const TSCRIPTS_DIR = join(SCRIPT_DIR, '..');
const BASE_TRANSLATIONS_PATH = join(TSCRIPTS_DIR, '..');
const CACHE_FILE_PATH = join(SCRIPT_DIR, '.runner-cache.json');

const config = {
    paths: {
        base: BASE_TRANSLATIONS_PATH,
        scripts: SCRIPT_DIR,
        tscriptsFolder: TSCRIPTS_DIR,
    },
    tasks: {
        "glossary": { path: join(SCRIPT_DIR, 'rules.ts') },
        "find": { path: join(SCRIPT_DIR, 'finder.ts') },
        "replace": { path: join(SCRIPT_DIR, 'replace.ts') },
        "dist": { path: join(SCRIPT_DIR, 'dist.ts') },
        "schema": { path: join(SCRIPT_DIR, 'schema.ts') },
        "merge": { path: join(SCRIPT_DIR, 'merge.ts') },
        "init": { path: join(SCRIPT_DIR, 'init.ts') },
        "runner": { path: join(SCRIPT_DIR, 'run.ts') },
        "code": {},
    } as const,
};

type TaskName = keyof typeof config.tasks;

function logTaskTime(startTime: number, endTime: number) {
    const durationMs = endTime - startTime;
    const durationS = (durationMs / 1000).toFixed(2);
    console.log(`\n✨ Task execution time: ${durationS}s`);
}

interface Cache {
    lastProject?: string;
}

async function readCache(): Promise<Cache> {
    if (!existsSync(CACHE_FILE_PATH)) {
        return {};
    }
    try {
        return await Bun.file(CACHE_FILE_PATH).json();
    } catch (error: any) {
        logWarning(`Could not read cache file: ${error.message}`);
        return {};
    }
}

async function writeCache(cache: Cache): Promise<void> {
    try {
        await Bun.write(CACHE_FILE_PATH, JSON.stringify(cache, null, 2));
    } catch (error: any) {
        logError(`Could not write to cache file: ${error.message}`);
    }
}

async function selectProject(): Promise<string | null | undefined> {
    try {
        const directories = readdirSync(config.paths.base).filter(file => {
            const fullPath = join(config.paths.base, file);
            return statSync(fullPath).isDirectory() && file !== 'tscripts';
        });

        if (directories.length === 0) {
            logError('No project directories found in:', config.paths.base);
            return null;
        }

        if (directories.length === 1) {
            const projectName = directories[0];
            console.log(`\n✅ Only one project found. Auto-selecting: ${projectName}`);
            await writeCache({ lastProject: projectName });
            return projectName;
        }

        const cache = await readCache();
        const lastProject = cache.lastProject;

        if (lastProject && directories.includes(lastProject)) {
            const { useLast } = await prompts({
                type: 'confirm',
                name: 'useLast',
                message: `Use last selected project: ${lastProject}?`,
                initial: true,
            });

            if (useLast) {
                console.log(`\n✅ Using cached project: ${lastProject}`);
                return lastProject;
            }
        }

        const { projectName } = await prompts({
            type: 'select',
            name: 'projectName',
            message: 'Select a translation project:',
            choices: directories.map(dir => ({ title: dir, value: dir })),
        });

        if (projectName) {
            await writeCache({ ...cache, lastProject: projectName });
        }

        return projectName || null;

    } catch (error) {
        logError('Error reading project directories:', error);
        return null;
    }
}

async function getTaskArguments(task: TaskName): Promise<string[] | null> {
    switch (task) {
        case "find": {
            const { searchTerm } = await prompts({
                type: 'text',
                name: 'searchTerm',
                message: 'Enter search pattern (required)',
                validate: (value: string) => value.trim().length > 0 || 'Search pattern cannot be empty.',
            });
            if (!searchTerm) return null;

            const { startNum } = await prompts({
                type: 'number',
                name: 'startNum',
                message: 'Enter start file number (optional)',
            });

            const { endNum } = await prompts({
                type: 'number',
                name: 'endNum',
                message: 'Enter end file number (optional)',
            });

            const { otherFlags } = await prompts({
                type: 'text',
                name: 'otherFlags',
                message: "Enter additional flags (optional, e.g., -o 'out.txt')",
            });

            const args: string[] = [searchTerm];
            if (typeof startNum === 'number') args.push('--start', startNum.toString());
            if (typeof endNum === 'number') args.push('--end', endNum.toString());
            args.push(...(otherFlags?.split(' ').filter(Boolean) || []));

            return args;
        }

        case "replace": {
            const { search, replace } = await prompts([
                { type: 'text', name: 'search', message: "Search Pattern (required)" },
                { type: 'text', name: 'replace', message: "Replacement (required)" }
            ]);
            if (!search || !replace) return null;

            const args: string[] = [];
            if (search) args.push('--search_pattern', search);
            if (replace) args.push('--replacement', replace);
            return args;
        }

        case "init": {
            const { projectName } = await prompts({
                type: 'text',
                name: 'projectName',
                message: 'Enter new project name (required)',
                validate: (value: string) => {
                    if (!value.trim()) return 'Project name cannot be empty.';
                    if (/[<>:"/\\|?*]/.test(value)) {
                        return 'Project name contains invalid characters.';
                    }
                    return true;
                },
            });
            if (!projectName) return null;

            return ['--projectName', projectName];
        }

        case "code": {
            const scriptsToEdit = Object.keys(config.tasks).filter((t): t is TaskName => t !== 'code' && t !== 'runner');
            const { scriptToEdit } = await prompts({
                type: 'select',
                name: 'scriptToEdit',
                message: 'Select a script to edit:',
                choices: scriptsToEdit.map(s => ({ title: s, value: s })),
            });
            return scriptToEdit ? [scriptToEdit] : null;
        }

        default:
            return [];
    }
}

async function handleCodeTask(args: string[]) {
    console.log(`\n🚀 Executing task: code`);
    const scriptToEdit = args[0] as TaskName | undefined;

    let pathToOpen = config.paths.tscriptsFolder;
    let openMessage = `✏️ No script specified. Opening the main 'tscripts' folder...`;

    if (scriptToEdit) {
        const taskDefinition = config.tasks[scriptToEdit];

        if ('path' in taskDefinition && typeof taskDefinition.path === 'string') {
            pathToOpen = taskDefinition.path;
            openMessage = `✏️ Opening script '${scriptToEdit}' in VS Code...`;
        }
    }

    try {
        console.log(openMessage);
        const startTime = performance.now();
        await $`code ${pathToOpen}`.quiet();
        const endTime = performance.now();
        logTaskTime(startTime, endTime);
        console.log('✅ Task finished.');
    } catch (error) {
        logError(`Failed to open VS Code. Is 'code' command in your PATH?`, error);
    }
}

async function handleInitTask(initialArgs: string[]) {
    console.log(`\n🚀 Executing task: init`);

    const taskDefinition = config.tasks.init;
    const finalArgs = [...initialArgs];

    if (!finalArgs.includes('--basePath') && !finalArgs.includes('-bp')) {
        finalArgs.push('--basePath', config.paths.base);
    }

    console.log(`   With args: ${finalArgs.join(' ')}`);

    try {
        const startTime = performance.now();
        const proc = Bun.spawn(['bun', 'run', taskDefinition.path, ...finalArgs], {
            stdio: ['inherit', 'inherit', 'inherit'],
        });

        const exitCode = await proc.exited;
        const endTime = performance.now();
        logTaskTime(startTime, endTime);

        if (exitCode !== 0) {
            throw new Error(`Process exited with code ${exitCode}`);
        }
        console.log(`\n✅ Task 'init' finished successfully.`);
    } catch (error) {
        logError(`Task 'init' failed:`, error);
    }
}

async function handleStandardTask(task: Exclude<TaskName, 'code' | 'init'>, initialArgs: string[]) {
    const projectName = await selectProject();
    if (!projectName) {
        logWarning('No project selected. Exiting.');
        return;
    }
    console.log(`\n✅ Project set to: ${projectName}`);

    const projectPath = join(config.paths.base, projectName);

    const taskDefinition = config.tasks[task];
    if (!('path' in taskDefinition) || !taskDefinition.path) {
        logError(`Task '${task}' does not have a valid script path to run.`);
        return;
    }

    const finalArgs: string[] = [];
    switch (task) {
        case 'glossary': {
            const assetsPath = join(projectPath, 'assets');
            const translationsPath = join(projectPath, 'translations');
            finalArgs.push('--assets-path', assetsPath, '--translations-path', translationsPath, ...initialArgs);
            break;
        }
        case 'dist': {
            const translationsDir = join(projectPath, "translations");
            const assetsDir = join(projectPath, "assets");
            const distDir = join(projectPath, "dist");
            finalArgs.push('--translations-dir', translationsDir, '--assets-dir', assetsDir, '--dist-dir', distDir, ...initialArgs);
            break;
        }
        case 'find':
        case 'replace': {
            const projectTranslationsPath = join(projectPath, 'translations');
            finalArgs.push('--folder', projectTranslationsPath, ...initialArgs);
            break;
        }
        case 'schema': {
            const glossaryPath = join(projectPath, 'assets', 'glossary.json');
            const markdownFolder = join(projectPath, 'translations');
            const outputPath = join(projectPath, 'assets', 'glossary-updated.json');
            finalArgs.push('--glossary-path', glossaryPath, '--markdown-folder', markdownFolder, '--output-path', outputPath, ...initialArgs);
            break;
        }
        case 'merge': {
            const glossaryFile = join(projectPath, 'assets', 'glossary.json');
            finalArgs.push('--glossary-file', glossaryFile, ...initialArgs);
            break;
        }
        default:
            finalArgs.push(...initialArgs);
    }

    console.log(`\n🚀 Executing task: ${task}`);
    if (finalArgs.length > 0) {
        console.log(`   With args: ${finalArgs.join(' ')}`);
    }

    try {
        const startTime = performance.now();
        const proc = Bun.spawn(['bun', 'run', taskDefinition.path, ...finalArgs], {
            stdio: ['inherit', 'inherit', 'inherit'],
        });

        const exitCode = await proc.exited;
        const endTime = performance.now();
        logTaskTime(startTime, endTime);

        if (exitCode !== 0) {
            throw new Error(`Process exited with code ${exitCode}`);
        }
        console.log(`\n✅ Task '${task}' finished successfully.`);
    } catch (error) {
        logError(`Task '${task}' failed:`, error);
    }
}

async function main() {
    const cliArgs = process.argv.slice(2);
    let taskName: TaskName | null = null;
    let taskArgs: string[] | null = [];

    if (cliArgs.length > 0) {
        const task = cliArgs[0] as TaskName;
        if (!Object.keys(config.tasks).includes(task)) {
            logError(`Invalid task name '${task}'.`);
            return;
        }
        taskName = task;
        taskArgs = cliArgs.slice(1);
    } else {
        const { selectedTask } = await prompts({
            type: 'select',
            name: 'selectedTask',
            message: 'Select a task to run:',
            choices: Object.keys(config.tasks)
                .filter(t => t !== 'runner')
                .sort()
                .map(t => ({ title: t, value: t })),
        });
        taskName = selectedTask as TaskName || null;

        if (taskName) {
            taskArgs = await getTaskArguments(taskName);
        }
    }

    if (!taskName) {
        logWarning('No task selected. Exiting.');
        return;
    }
    if (taskArgs === null) {
        logWarning('Task aborted. Exiting.');
        return;
    }

    if (taskName === 'code') {
        await handleCodeTask(taskArgs);
    } else if (taskName === 'init') {
        await handleInitTask(taskArgs);
    } else {
        await handleStandardTask(taskName as Exclude<TaskName, 'code' | 'init'>, taskArgs);
    }
}

main();