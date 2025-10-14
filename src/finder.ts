import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, extname, basename } from "path";
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

export interface SearchResult {
    fileName: string;
    lineNumber: number;
    lineContent: string;
}

export interface SearchOutput {
    results: SearchResult[];
    firstMatchFile: string | null;
    fileFirstLines: Map<string, string>;
}

function getSortedMarkdownFiles(folderPath: string): string[] {
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
        throw new Error(`The folder path '${folderPath}' does not exist or is not a directory.`);
    }

    const files = readdirSync(folderPath).filter(f => extname(f) === ".md");

    files.sort((a, b) => {
        const aNum = parseInt(basename(a, ".md"));
        const bNum = parseInt(basename(b, ".md"));
        return (isNaN(aNum) || isNaN(bNum)) ? a.localeCompare(b) : aNum - bNum;
    });

    return files;
}

function getFileContentsWithNumbers(folderPath: string): Map<number, string> {
    const fileContentsByNumber = new Map<number, string>();
    const files = getSortedMarkdownFiles(folderPath);

    files.forEach(file => {
        const baseName = basename(file, ".md");
        const fileNumber = parseInt(baseName, 10);

        if (!isNaN(fileNumber)) {
            const content = readFileSync(file, "utf-8").toLowerCase();
            fileContentsByNumber.set(fileNumber, content);
        } else {
            console.log(`Skipping non-numeric file: ${file}`);
        }
    });

    return fileContentsByNumber;
}

function createMatcher(searchPattern: string, useRegex: boolean): (line: string) => boolean {
    if (useRegex) {
        const regex = new RegExp(searchPattern, "i");
        return (line: string) => regex.test(line);
    }
    const lowerCasePattern = searchPattern.toLowerCase();
    return (line: string) => line.toLowerCase().includes(lowerCasePattern);
}

export function findFirstFileWithMatchInFolder(folderPath: string, searchPattern: string, useRegex = false): number | null {
    const fileContentsByNumber = getFileContentsWithNumbers(folderPath);
    return findFirstFileWithMatch(fileContentsByNumber, searchPattern, useRegex);
}

export function findFirstFileWithMatch(fileContentsByNumber: Map<number, string>, searchPattern: string, useRegex = false): number | null {
    const lineMatches = createMatcher(searchPattern, useRegex);

    for (const [fileNumber, content] of fileContentsByNumber.entries()) {
        const lines = content.split(/\r?\n/);

        for (const line of lines) {
            if (lineMatches(line)) {
                return fileNumber;
            }
        }
    }

    return null;
}


export function searchInFolder(folderPath: string, searchPattern: string, useRegex = false): SearchOutput {
    const files = getSortedMarkdownFiles(folderPath);
    const results: SearchResult[] = [];
    const fileFirstLines = new Map<string, string>();
    let firstMatchFile: string | null = null;
    const lineMatches = createMatcher(searchPattern, useRegex);

    for (const fileName of files) {
        const filePath = join(folderPath, fileName);
        try {
            const content = readFileSync(filePath, { encoding: "utf-8" });
            const lines = content.split(/\r?\n/);

            fileFirstLines.set(fileName, lines[0] ?? "");

            let fileHasMatch = false;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? "";
                if (lineMatches(line)) {
                    results.push({
                        fileName: fileName,
                        lineNumber: i + 1,
                        lineContent: line.trimEnd(),
                    });
                    fileHasMatch = true;
                }
            }

            if (fileHasMatch && firstMatchFile === null) {
                firstMatchFile = fileName;
            }
        } catch (e) {
            console.error(`Error: Failed to read ${filePath}: ${(e as Error).message}`);
        }
    }

    return { results, firstMatchFile, fileFirstLines };
}


function printTable(results: SearchResult[]): void {
    if (results.length === 0) return;

    const fileColWidth = Math.max(...results.map(r => r.fileName.length), "File".length);
    const lineColWidth = Math.max(...results.map(r => r.lineNumber.toString().length), "Line".length);
    const textColWidth = Math.max(...results.map(r => r.lineContent.length), "Text".length);

    const header = `${"File".padEnd(fileColWidth)} | ${"Line".padEnd(lineColWidth)} | ${"Text".padEnd(textColWidth)}`;
    console.log(header);
    console.log("-".repeat(header.length));

    for (const { fileName, lineNumber, lineContent } of results) {
        console.log(`${fileName.padEnd(fileColWidth)} | ${lineNumber.toString().padEnd(lineColWidth)} | ${lineContent.padEnd(textColWidth)}`);
    }
}

function writeParagraphsToFile(results: SearchResult[], fileFirstLines: Map<string, string>, outputFile: string): void {
    try {
        const resultsByFile = results.reduce((acc, result) => {
            const { fileName } = result;
            if (!acc.has(fileName)) {
                acc.set(fileName, []);
            }
            acc.get(fileName)!.push(result);
            return acc;
        }, new Map<string, SearchResult[]>());

        const outputLines: string[] = [];

        for (const [fileName, fileResults] of resultsByFile.entries()) {
            const firstLine = fileFirstLines.get(fileName) ?? `[Error retrieving first line of ${fileName}]`;
            outputLines.push(firstLine);

            for (const { lineNumber, lineContent } of fileResults) {
                outputLines.push(`[${lineNumber}] ${lineContent}\n`);
            }
        }

        writeFileSync(outputFile, outputLines.join("\n"), { encoding: "utf-8", flag: "w+" });
    } catch (e) {
        console.error(`Error: Failed to write to ${outputFile}: ${(e as Error).message}`);
    }
}


async function main() {
    const argv = await yargs(hideBin(process.argv))
        .usage('Usage: bun run finder.ts <searchPattern> [options]')
        .positional('searchPattern', {
            describe: 'Search word or regex pattern',
            type: 'string',
            demandOption: true,
        })
        .option('folder', {
            alias: 'f',
            type: 'string',
            description: 'Folder to scan',
            demandOption: true,
        })
        .option('regex', {
            type: 'boolean',
            description: 'Treat search pattern as a regular expression',
            default: false,
        })
        .option('output', {
            alias: 'o',
            type: 'string',
            description: 'Output file to write paragraphs to (optional)',
        })
        .option('quiet', {
            alias: 'q',
            type: 'boolean',
            description: 'Suppress table output, only show summary',
            default: false,
        })
        .demandCommand(1, 'Error: You must provide a search pattern.')
        .help()
        .alias('help', 'h')
        .parse();

    const searchPattern = argv._[0] as string;
    const { folder, regex, output, quiet } = argv;

    try {
        const { results, firstMatchFile, fileFirstLines } = searchInFolder(folder, searchPattern, regex);

        if (results.length > 0) {
            if (!quiet) {
                console.log(`\nResults for pattern '${searchPattern}':\n`);
                printTable(results);
            }
            if (output) {
                const outputPath = join(process.cwd(), output.replaceAll(/['"]/g, ""));
                console.log(`\nWriting results to ${outputPath}...`);
                writeParagraphsToFile(results, fileFirstLines, outputPath);
            }
        } else {
            console.log(`The pattern '${searchPattern}' was not found in any file.`);
        }

        console.log(`\n---\nSummary:\n---`);
        console.log(`First match found in file: ${firstMatchFile ?? 'N/A'}`);
        console.log(`Total matches: ${results.length}`);

        if (output && results.length > 0) {
            console.log(`Output written to: ${output}`);
        }
    } catch (e) {
        console.error(`Fatal error: ${(e as Error).message}`);
        process.exit(1);
    }
}

if (import.meta.main) {
    main();
}