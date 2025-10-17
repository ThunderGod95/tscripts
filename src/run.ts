import prompts from 'prompts';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

// --- Configuration ---
// Dynamically determine paths based on the script's location.
// Assumes the folder structure is:
// /<some_folder>/Translations/
//   ├── project-A/
//   ├── project-B/
//   └── tscripts/
//       └── src/
//           ├── (this script)
//           └── (other task scripts)
const SCRIPT_DIR = join(import.meta.dir);
const TSCRIPTS_DIR = join(SCRIPT_DIR, '..');
const BASE_TRANSLATIONS_PATH = join(TSCRIPTS_DIR, '..');

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
        "runner": { path: join(SCRIPT_DIR, 'run.ts') },
        "code": {},
    } as const,
};

type TaskName = keyof typeof config.tasks;

function logError(message: string, error?: unknown) {
    console.error(`❌ ${message}`, error instanceof Error ? error.message : error || '');
}

function logWarning(message: string) {
    console.warn(`🟡 ${message}`);
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
            return projectName;
        }

        const { projectName } = await prompts({
            type: 'select',
            name: 'projectName',
            message: 'Select a translation project:',
            choices: directories.map(dir => ({ title: dir, value: dir })),
        });
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

            const { otherFlags } = await prompts({
                type: 'text',
                name: 'otherFlags',
                message: "Enter additional flags (optional, e.g., -o 'out.txt')",
            });
            return [searchTerm, ...(otherFlags?.split(' ').filter(Boolean) || [])];
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
            pathToOpen = taskDefinition.path; // No '!' needed, it's now type-safe
            openMessage = `✏️ Opening script '${scriptToEdit}' in VS Code...`;
        }
    }

    try {
        console.log(openMessage);
        await $`code ${pathToOpen}`.quiet();
        console.log('✅ Task finished.');
    } catch (error) {
        logError(`Failed to open VS Code. Is 'code' command in your PATH?`, error);
    }
}

async function handleStandardTask(task: Exclude<TaskName, 'code'>, initialArgs: string[]) {
    const projectName = await selectProject();
    if (!projectName) {
        logWarning('No project selected. Exiting.');
        return;
    }
    console.log(`\n✅ Project set to: ${projectName}`);

    const taskDefinition = config.tasks[task];
    if (!taskDefinition.path) {
        logError(`Task '${task}' does not have a valid script path to run.`);
        return;
    }

    console.log(`\n🚀 Executing task: ${task}`);
    const projectTranslationsPath = join(config.paths.base, projectName, 'translations');
    const finalArgs: string[] = [];

    switch (task) {
        case 'glossary':
            finalArgs.push('--project', projectName, ...initialArgs);
            break;
        case 'find':
        case 'replace':
            finalArgs.push('--folder', projectTranslationsPath, ...initialArgs);
            break;
        default:
            finalArgs.push(...initialArgs);
    }

    if (finalArgs.length > 0) {
        console.log(`   With args: ${finalArgs.join(' ')}`);
    }

    try {
        const proc = Bun.spawn(['bun', 'run', taskDefinition.path, ...finalArgs], {
            stdio: ['inherit', 'inherit', 'inherit'],
        });

        const exitCode = await proc.exited;
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
    } else {
        await handleStandardTask(taskName, taskArgs);
    }
}

main();