import { readdir } from 'fs/promises';
import { join } from 'path';
import pino from 'pino';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const transport = {
    target: 'pino-pretty',
    options: { colorize: true },
};

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    transport,
});

const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();
const isLower = (s: string) => s === s.toLowerCase() && s !== s.toUpperCase();
const isTitle = (s: string) =>
    s.length > 0 &&
    isUpper(s[0]!) &&
    (s.length === 1 || s.substring(1) === s.substring(1).toLowerCase());
const toTitle = (s: string) =>
    s.length > 0 ? s[0]!.toUpperCase() + s.substring(1).toLowerCase() : "";

function matchCase(word: string, replacement: string): string {
    const wordParts = word.split(' ');
    const replacementParts = replacement.split(' ');

    if (wordParts.length > 1 && wordParts.length === replacementParts.length) {
        const singleWord = (w: string, r: string): string => {
            if (isUpper(w)) return r.toUpperCase();
            if (isTitle(w)) return toTitle(r);
            if (isLower(w)) return r.toLowerCase();
            return r;
        };
        return wordParts.map((w, i) => singleWord(w, replacementParts[i]!)).join(' ');
    }

    if (isUpper(word)) return replacement.toUpperCase();
    if (isTitle(word)) return toTitle(replacement);
    if (isLower(word)) return replacement.toLowerCase();
    return replacement;
}

let totalReplacements = 0;

async function replaceInFile(
    filepath: string,
    searchRegex: RegExp,
    replacement: string
) {
    try {
        const file = Bun.file(filepath);
        if (!(await file.exists())) return;

        const content = await file.text();

        const lines = content.split('\n');
        const newLines: string[] = [];
        let fileModified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const lineNum = i + 1;
            let lineModified = false;

            const newLine = line.replace(searchRegex, (match, ...args) => {
                const offset: number = args[args.length - 2];
                const rep = matchCase(match, replacement);
                const wordNum =
                    line.substring(0, offset).split(/\s+/).filter(Boolean).length + 1;

                logger.debug(
                    `${filepath}: line ${lineNum}, word ${wordNum}: '${match}' => '${rep}'`
                );

                lineModified = true;
                totalReplacements++;
                return rep;
            });

            if (lineModified) fileModified = true;
            newLines.push(newLine);
        }

        if (fileModified) {
            await Bun.write(filepath, newLines.join('\n'));
        }
    } catch (error) {
        logger.error(
            `Failed to process file ${filepath}: ${error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

async function replaceInFolder(
    folderPath: string,
    searchPattern: string,
    replacement: string
) {
    const searchRegex = new RegExp(searchPattern, 'gi');
    let entries;

    try {
        entries = await readdir(folderPath, { withFileTypes: true });
    } catch (error) {
        logger.error(
            `Failed to read directory ${folderPath}: ${error instanceof Error ? error.message : String(error)
            }`
        );
        return;
    }

    const filePromises: Promise<void>[] = [];

    for (const entry of entries) {
        if (entry.isFile()) {
            const fpath = join(folderPath, entry.name);
            filePromises.push(replaceInFile(fpath, searchRegex, replacement));
        }
    }

    await Promise.all(filePromises);
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('folder', {
            alias: 'f',
            type: 'string',
            description: 'Folder path containing files to process',
            demandOption: true,
        })
        .option('search_pattern', {
            alias: 's',
            type: 'string',
            description: 'Regex pattern to search (case-insensitive)',
            demandOption: true,
        })
        .option('replacement', {
            alias: 'r',
            type: 'string',
            description: 'Replacement phrase',
            demandOption: true,
        })
        .help()
        .alias('help', 'h')
        .parse();

    const folderPath = argv.folder as string;
    const searchPattern = argv.search_pattern as string;
    const replacement = argv.replacement as string;

    logger.info(`Starting replacements in folder: ${folderPath}`);
    logger.info(`Searching for: "${searchPattern}"`);
    logger.info(`Replacing with: "${replacement}"`);

    await replaceInFolder(folderPath, searchPattern, replacement);

    logger.info("Replacements complete.");
    logger.info(`Total replacements made: ${totalReplacements}`);
}

main().catch((err) => {
    logger.fatal(`Unhandled error: ${err}`);
    process.exit(1);
});