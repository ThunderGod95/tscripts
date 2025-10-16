import prompts from 'prompts';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

const BASE_TRANSLATIONS_PATH = 'C:/Users/tarun/Translations';
const SCRIPTS_PATH = 'C:/Users/tarun/Translations/tscripts/src';

const taskDefinitions = {
    "glossary": { path: join(SCRIPTS_PATH, 'rules.ts') },
    "find": { path: join(SCRIPTS_PATH, 'finder.ts') },
    "replace": { path: join(SCRIPTS_PATH, 'replace.ts') },
    "runner": { path: join(SCRIPTS_PATH, 'run.ts') },
    "code": {}
};

async function selectProject(): Promise<string | null> {
    try {
        const directories = readdirSync(BASE_TRANSLATIONS_PATH)
            .filter(file => {
                const fileStat = statSync(join(BASE_TRANSLATIONS_PATH, file));
                return fileStat.isDirectory() && file !== 'tscripts';
            });

        if (directories.length === 0) {
            console.error('❌ No project directories found in:', BASE_TRANSLATIONS_PATH);
            return null;
        }

        if (directories.length === 1) {
            const projectName = directories[0]!;
            console.log(`\n✅ Only one project found. Auto-selecting: ${projectName}`);
            return projectName;
        }

        const response = await prompts({
            type: 'select',
            name: 'projectName',
            message: 'Select a translation project:',
            choices: directories.map(dir => ({ title: dir, value: dir })),
        });
        return response.projectName || null;

    } catch (error) {
        console.error('❌ Error reading project directories:', error);
        return null;
    }
}

async function showTaskMenu(): Promise<string | null> {
    const menuItems = Object.keys(taskDefinitions).filter(t => t !== 'runner').sort();
    const response = await prompts({
        type: 'select',
        name: 'taskName',
        message: 'Select a task to run:',
        choices: menuItems.map(task => ({ title: task, value: task })),
    });
    return response.taskName || null;
}

async function getTaskArguments(selectedTask: string): Promise<string[] | null> {
    switch (selectedTask) {
        case "find": {
            const { searchTerm } = await prompts({
                type: 'text',
                name: 'searchTerm',
                message: 'Enter search pattern (required)',
                validate: (value: string) => value.length > 0 ? true : 'Search pattern cannot be empty.'
            });
            if (!searchTerm) return null;

            const { otherFlags } = await prompts({
                type: 'text',
                name: 'otherFlags',
                message: "Enter additional flags (optional) (e.g., -o 'file.txt' --regex)"
            });
            return [searchTerm, ...(otherFlags?.split(' ').filter(Boolean) || [])];
        }

        case "replace": {
            const response = await prompts([
                { type: 'text', name: 'search', message: "Search Pattern (default: '')" },
                { type: 'text', name: 'replace', message: "Replacement (default: '')" }
            ]);
            const args: string[] = [];
            if (response.search) args.push('--search_pattern', response.search);
            if (response.replace) args.push('--replacement', response.replace);
            return args;
        }

        case "code": {
            const scriptsToEdit = Object.keys(taskDefinitions).filter(t => t !== 'code');
            const response = await prompts({
                type: 'select',
                name: 'scriptToEdit',
                message: 'Select a script to edit:',
                choices: scriptsToEdit.map(s => ({ title: s, value: s })),
            });
            return response.scriptToEdit ? [response.scriptToEdit] : null;
        }

        default:
            return [];
    }
}

async function main() {
    let taskName: string | null = null;
    let initialArgs: string[] = [];
    const cliArgs = process.argv.slice(2);

    if (cliArgs.length > 0) {
        taskName = cliArgs[0]!;
        initialArgs = cliArgs.slice(1);
        if (!taskDefinitions.hasOwnProperty(taskName)) {
            console.error(`❌ Error: Invalid task name '${taskName}'.`);
            return;
        }
    } else {
        taskName = await showTaskMenu();
        if (!taskName) {
            console.warn('🟡 No task selected. Exiting.');
            return;
        }
        const args = await getTaskArguments(taskName);

        if (args === null && taskName !== 'code') {
            console.warn('🟡 Task aborted. Exiting.');
            return;
        }

        initialArgs = args ?? [];
    }

    if (taskName === 'code') {
        console.log(`\n🚀 Executing task: ${taskName}`);
        console.time(`Task '${taskName}' finished`);
        const scriptToEdit = initialArgs[0] ?? null;

        let pathToOpen: string | null = null;
        let openMessage = "";

        if (scriptToEdit && taskDefinitions.hasOwnProperty(scriptToEdit)) {
            const scriptDef = taskDefinitions[scriptToEdit as keyof typeof taskDefinitions];
            if ('path' in scriptDef && typeof scriptDef.path === 'string') {
                pathToOpen = scriptDef.path;
                openMessage = `✏️ Opening script '${scriptToEdit}' in VS Code...`;
            } else {
                console.error(`❌ Script '${scriptToEdit}' does not have a valid path to open.`);
                return;
            }
        } else {
            pathToOpen = 'C:/Users/tarun/Translations/tscripts';
            openMessage = `✏️ No valid script specified. Opening 'tscripts' folder...`;
        }

        try {
            console.log(openMessage);
            await $`code ${pathToOpen}`.quiet();
            console.timeEnd(`Task '${taskName}' finished`);
        } catch (error) {
            console.error(`\n❌ Task '${taskName}' failed:`, error);
        }
        return;
    }

    const projectName = await selectProject();
    if (!projectName) {
        console.warn('🟡 No project selected. Exiting.');
        return;
    }
    console.log(`\n✅ Project set to: ${projectName}`);

    const scriptDef = taskDefinitions[taskName as keyof typeof taskDefinitions];
    if (!('path' in scriptDef) || typeof scriptDef.path !== 'string') {
        console.error(`❌ Task '${taskName}' does not have a valid script path to run.`);
        return;
    }

    console.log(`\n🚀 Attempting to execute task: ${taskName}`);
    console.time(`Task '${taskName}' finished successfully.`);

    try {
        const projectTranslationsPath = join(BASE_TRANSLATIONS_PATH, projectName, 'translations');
        const scriptPath = scriptDef.path;
        const finalArgs: string[] = [];

        switch (taskName) {
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

        const argString = finalArgs.join(' ');
        if (argString) console.log(`With args: ${argString}`);

        const proc = Bun.spawn(['bun', 'run', scriptPath, ...finalArgs], {
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
        });

        const exitCode = await proc.exited;
        if (exitCode !== 0) {
            throw new Error(`Process exited with code ${exitCode}`);
        }
        console.timeEnd(`Task '${taskName}' finished successfully.`);

    } catch (error) {
        console.error(`\n❌ Task '${taskName}' failed:`, error);
    }
}

main();