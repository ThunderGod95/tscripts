import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, extname, basename } from "path";
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

export type Result = [string, number, string];

// --- NO CHANGES TO THE CORE LOGIC FUNCTIONS ---
// The functions findFirstWordInstanceInFolder, findFirstWordInstance,
// findWordAllInstances, printTable, and writeParagraphsToFile
// remain exactly the same as before.

export function findFirstWordInstanceInFolder(folderPath: string, searchPattern: string, useRegex = false): number | null {
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
        throw new Error(`The folder path '${folderPath}' does not exist or is not a directory.`);
    }

    const files = readdirSync(folderPath).filter(f => extname(f) === ".md");

    files.sort((a, b) => {
        const aNum = parseInt(basename(a, ".md"));
        const bNum = parseInt(basename(b, ".md"));
        if (isNaN(aNum) || isNaN(bNum)) return a.localeCompare(b);
        return aNum - bNum;
    });

    const mdFileContents = new Map<number, string>();

    for (const file of files) {
        const filePath = join(folderPath, file);

        try {
            const content = readFileSync(filePath, { encoding: "utf-8" });
            mdFileContents.set(parseInt(basename(filePath, ".md")), content);
        } catch (e) {
            console.error(`Error: Failed to read ${filePath}: ${(e as Error).message}`);
            continue;
        }
    }

    return findFirstWordInstance(mdFileContents, searchPattern, useRegex);
}

export function findFirstWordInstance(content: Map<number, string>, searchPattern: string, useRegex = false): number | null {
    let regex: RegExp | null = null;

    if (useRegex) {
        regex = new RegExp(searchPattern, "i");
    }

    for (const [fileNum, fileContent] of content.entries()) {
        const lines = (fileContent ?? "").split(/\r?\n/);
        for (const line of lines) {
            if (useRegex && regex) {
                if (regex.test(line ?? "")) {
                    return fileNum;
                }
            } else {
                if (line?.toLowerCase().includes(searchPattern.toLowerCase())) {
                    return fileNum;
                }
            }
        }
    }

    return null;
}

export function findWordAllInstances(folderPath: string, searchPattern: string, useRegex = false): { results: Result[]; filesScanned: number; totalMatches: number } {
    const results: Result[] = [];
    let filesScanned = 0;
    let totalMatches = 0;
    let regex: RegExp | null = null;

    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
        throw new Error(`The folder path '${folderPath}' does not exist or is not a directory.`);
    }

    if (useRegex) {
        regex = new RegExp(searchPattern, "i");
    }

    const files = readdirSync(folderPath).filter(f => extname(f) === ".md");
    files.sort((a, b) => {
        const aNum = parseInt(basename(a, ".md"));
        const bNum = parseInt(basename(b, ".md"));
        if (isNaN(aNum) || isNaN(bNum)) return a.localeCompare(b);
        return aNum - bNum;
    });

    for (const fname of files) {
        const filePath = join(folderPath, fname);
        filesScanned++;
        try {
            const content = readFileSync(filePath, { encoding: "utf-8" });
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineNum = i + 1;
                if (useRegex && regex) {
                    if (regex.test(line ?? "")) {
                        results.push([fname, lineNum, (line ?? "").trimEnd()]);
                        totalMatches++;
                    }
                } else {
                    if (line?.toLowerCase().includes(searchPattern.toLowerCase())) {
                        results.push([fname, lineNum, line.trimEnd()]);
                        totalMatches++;
                    }
                }
            }
        } catch (e) {
            console.error(`Error: Failed to read ${filePath}: ${(e as Error).message}`);
            continue;
        }
    }

    return { results, filesScanned, totalMatches };
}

function printTable(results: Result[]): void {
    if (results.length === 0) return;

    const fileColWidth = Math.max(...results.map(r => r[0].length), "File".length);
    const lineColWidth = Math.max(...results.map(r => r[1].toString().length), "Line".length);
    const textColWidth = Math.max(...results.map(r => r[2].length), "Text".length);

    const header = `${"File".padEnd(fileColWidth)} | ${"Line".padEnd(lineColWidth)} | ${"Text".padEnd(textColWidth)}`;
    console.log(header);
    console.log("-".repeat(header.length));

    for (const [fname, lineNum, lineContent] of results) {
        console.log(`${fname.padEnd(fileColWidth)} | ${lineNum.toString().padEnd(lineColWidth)} | ${lineContent.padEnd(textColWidth)}`);
    }
}

function writeParagraphsToFile(results: Result[], outputFile: string, folderPath: string): void {
    try {
        const resultsByFile = new Map<string, Result[]>();
        for (const result of results) {
            const fname = result[0]; // Filename
            if (!resultsByFile.has(fname)) {
                resultsByFile.set(fname, []);
            }
            resultsByFile.get(fname)!.push(result);
        }

        const outputLines: string[] = [];

        for (const [fname, fileResults] of resultsByFile.entries()) {
            const filePath = join(folderPath, fname);
            let firstLine = "";
            try {
                const content = readFileSync(filePath, { encoding: "utf-8" });
                firstLine = content.split(/\r?\n/)[0] ?? "";
            } catch (e) {
                console.error(`Error: Failed to read ${filePath} to get first line: ${(e as Error).message}`);
                firstLine = `[Error reading first line of ${fname}]`;
            }
            outputLines.push(firstLine);

            for (const result of fileResults) {
                const lineNum = result[1];
                const lineContent = result[2];
                outputLines.push(`[${lineNum}] ${lineContent}\n`);
            }
        }

        writeFileSync(outputFile, outputLines.join("\n"), { encoding: "utf-8" });

    } catch (e) {
        console.error(`Error: Failed to write to ${outputFile}: ${(e as Error).message}`);
    }
}

// --- NEW YARGS-BASED MAIN FUNCTION ---

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
            description: 'Folder to scan (provided by runner script)',
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
            default: '',
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
        const start = Date.now();
        const { results, filesScanned, totalMatches } = findWordAllInstances(folder, searchPattern, regex);
        const elapsed = (Date.now() - start) / 1000;

        if (results.length > 0) {
            if (!quiet) {
                console.log(`\nResults for pattern '${searchPattern}':\n`);
                printTable(results);
            }
            if (output) { // Check if output is not an empty string
                writeParagraphsToFile(results, output, folder);
            }
        } else {
            console.log(`The pattern '${searchPattern}' was not found in any file.`);
        }

        console.log(`\nFiles scanned: ${filesScanned}`);
        console.log(`Total matches: ${totalMatches}`);
        console.log(`Elapsed Time: ${elapsed.toFixed(2)} seconds`);
        if (output && results.length > 0) {
            console.log(`Output written to: ${output}`);
        }
    } catch (e) {
        console.error(`Fatal error: ${(e as Error).message}`);
        process.exit(1);
    }
}

main();